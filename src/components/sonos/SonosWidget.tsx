import { memo, useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSonosTrackTransition } from "./hooks";

interface NowPlaying {
  track_name: string | null;
  artist_name: string | null;
  album_name?: string | null;
  album_art_url: string | null;
  next_album_art_url?: string | null;
  bg_image_url?: string | null;
  next_bg_image_url?: string | null;
  duration_ms: number | null;
  position_ms: number | null;
  playback_state: string;
}

interface SonosWidgetProps {
  isMobile?: boolean;
  isTvMode?: boolean;
  onAlbumArtChange?: (url: string | null) => void;
  showDebug?: boolean;
  onRealtimeRef?: React.MutableRefObject<((payload: any) => void) | null>;
}

const PLAYBACK_POLL_INTERVAL = 5000;
const PLAYBACK_POLL_TIMEOUT = 8000;
const PREDICTIVE_THRESHOLD_MS = 10000;
const PREDICTIVE_MARGIN_MS = 500;
const PREDICTIVE_RETRY_INTERVAL_MS = 1000;
const PREDICTIVE_MAX_RETRIES = 3;
const PREDICTIVE_COOLDOWN_MS = 3000;
const PREFETCH_THRESHOLD_MS = 30000; // Trigger server sync 30s before track ends

export const SonosWidget = memo(function SonosWidget({ isMobile = false, isTvMode = false, onAlbumArtChange, showDebug = false, onRealtimeRef }: SonosWidgetProps) {
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [showWidget, setShowWidget] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [localProgress, setLocalProgress] = useState<number | null>(null);
  const localProgressRef = useRef<number | null>(null);
  const [displayedArtUrl, setDisplayedArtUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldScroll, setShouldScroll] = useState(false);
  const [prefetchStatus, setPrefetchStatus] = useState<'idle' | 'fetching' | 'ready' | 'loaded'>('idle');
  const [currentArtStatus, setCurrentArtStatus] = useState<'displayed' | 'detecting' | 'loading'>('displayed');

  const onAlbumArtChangeRef = useRef(onAlbumArtChange);
  onAlbumArtChangeRef.current = onAlbumArtChange;
  const lastPredictivePollRef = useRef<number>(0);
  const predictiveScheduledRef = useRef(false);
  const prefetchTriggeredForTrackRef = useRef<string | null>(null);
  const trackChangeOffsetRef = useRef<number>(0);
  const earlySwapDoneRef = useRef(false);
  const bgSentRef = useRef<string | null>(null);
  const validBgBufferRef = useRef<string[]>([]);
  const trackChangedAtRef = useRef<number>(0);
  const hideGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [graceExpired, setGraceExpired] = useState(false);

  // Strip query params for comparison (cache-bust parameters cause false mismatches)
  const stripQuery = useCallback((url: string) => url.split('?')[0], []);

  // Rolling buffer: track last 6 known-valid bg URLs to verify sync
  const pushToBgBuffer = useCallback((url: string | null | undefined) => {
    if (!url) return;
    const buf = validBgBufferRef.current;
    const stripped = stripQuery(url);
    // Check if already present (ignoring query params)
    if (buf.some(u => stripQuery(u) === stripped)) return;
    buf.push(url);
    if (buf.length > 6) buf.shift();
  }, [stripQuery]);

  const setLocalProgressWithRef = useCallback((val: number | null | ((prev: number | null) => number | null)) => {
    if (typeof val === 'function') {
      setLocalProgress(prev => {
        const next = val(prev);
        localProgressRef.current = next;
        return next;
      });
    } else {
      localProgressRef.current = val;
      setLocalProgress(val);
    }
  }, []);

  const { fetchNowPlaying, handleTrackUpdate } = useSonosTrackTransition({
    setNowPlaying,
    setLocalProgress: setLocalProgressWithRef,
  });

  // Consolidated 1s ticker: progress + predictive scheduling + prefetch trigger
  useEffect(() => {
    if (!nowPlaying?.track_name || nowPlaying.playback_state === 'PLAYBACK_STATE_IDLE' || !nowPlaying.duration_ms) return;

    const duration = nowPlaying.duration_ms;
    const trackName = nowPlaying.track_name;
    let predictiveTimer: ReturnType<typeof setTimeout> | null = null;

    const pollForNewTrack = async (retriesLeft: number) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), PLAYBACK_POLL_TIMEOUT);
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sonos-playback-status`,
          {
            headers: {
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
              'Content-Type': 'application/json',
            },
            signal: controller.signal,
          }
        );
        clearTimeout(timeout);
        if (!response.ok) return;
        const data = await response.json();
        if (!data.ok) return;

        lastPredictivePollRef.current = Date.now();

        const trackChanged = data.trackName && data.trackName !== trackName;
        if (trackChanged) {
          localProgressRef.current = data.positionMillis;
          setLocalProgress(data.positionMillis);
          trackChangedAtRef.current = Date.now();
          const alreadySwapped = earlySwapDoneRef.current;
          setNowPlaying(prev => {
            if (!prev) return prev;
            if (alreadySwapped) {
              // Images already swapped by early swap — only update text metadata
              setCurrentArtStatus('displayed');
              return {
                ...prev,
                track_name: data.trackName,
                artist_name: data.artistName ?? prev.artist_name,
                album_name: data.albumName ?? prev.album_name,
                playback_state: data.playbackState,
                position_ms: data.positionMillis,
              };
            }
            // Not early-swapped — likely a random skip. Don't use stale next_ URLs.
            // Keep current art, update text only. Trigger server sync for correct art.
            fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-sonos-now-playing`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
                'Content-Type': 'application/json',
              },
            }).catch(() => {});
            return {
              ...prev,
              track_name: data.trackName,
              artist_name: data.artistName ?? prev.artist_name,
              album_name: data.albumName ?? prev.album_name,
              playback_state: data.playbackState,
              position_ms: data.positionMillis,
              next_album_art_url: null,
              next_bg_image_url: null,
            };
          });
          // Don't refetch from DB here - it likely has stale data. Realtime will deliver updates.
        } else if (retriesLeft > 0) {
          predictiveTimer = setTimeout(() => pollForNewTrack(retriesLeft - 1), PREDICTIVE_RETRY_INTERVAL_MS);
        } else {
          localProgressRef.current = data.positionMillis;
          setLocalProgress(data.positionMillis);
        }
      } catch {
        // ignore
      }
    };

    const ticker = window.setInterval(() => {
      try {
        const prev = localProgressRef.current;
        if (prev === null) return;
        const next = Math.min(prev + 1000, duration);
        localProgressRef.current = next;
        setLocalProgress(next);

        const timeRemaining = duration - next;

        // Early swap: switch images before track ends based on user offset
        const offsetMs = trackChangeOffsetRef.current * 1000;
        if (offsetMs > 0 && timeRemaining <= offsetMs && timeRemaining > 0 && !earlySwapDoneRef.current) {
          trackChangedAtRef.current = Date.now();
          setNowPlaying(prev => {
            if (!prev?.next_album_art_url) return prev;
          earlySwapDoneRef.current = true;
            setPrefetchStatus('loaded');
            const newArtUrl = prev.next_album_art_url || prev.album_art_url;
            const newBgUrl = prev.next_bg_image_url || prev.bg_image_url;
            pushToBgBuffer(newBgUrl || newArtUrl);
            onAlbumArtChangeRef.current?.(newBgUrl || newArtUrl);
            bgSentRef.current = newBgUrl || newArtUrl;
            return {
              ...prev,
              album_art_url: newArtUrl,
              bg_image_url: newBgUrl,
              next_album_art_url: null,
              next_bg_image_url: null,
            };
          });
        }

        // Prefetch: trigger server sync ~30s before end (once per track)
        if (timeRemaining <= PREFETCH_THRESHOLD_MS && timeRemaining > 0 && prefetchTriggeredForTrackRef.current !== trackName) {
          prefetchTriggeredForTrackRef.current = trackName;
          setPrefetchStatus('fetching');
          console.log(`[Sonos] Prefetching next track data (${Math.round(timeRemaining / 1000)}s remaining)`);
          const controller = new AbortController();
          const t = setTimeout(() => controller.abort(), 15000);
          fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-sonos-now-playing`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
              'Content-Type': 'application/json',
            },
            signal: controller.signal,
          }).then(res => {
            if (res.ok) setPrefetchStatus('ready');
          }).catch(() => {}).finally(() => clearTimeout(t));
        }

        // Predictive poll: schedule when <10s remain (once per track)
        if (timeRemaining <= PREDICTIVE_THRESHOLD_MS && timeRemaining > 0 && !predictiveScheduledRef.current) {
          predictiveScheduledRef.current = true;
          const delay = Math.max(timeRemaining + PREDICTIVE_MARGIN_MS, 100);
          predictiveTimer = setTimeout(() => pollForNewTrack(PREDICTIVE_MAX_RETRIES), delay);
        }
      } catch (err) {
        console.error('[Sonos] Ticker error:', err);
      }
    }, 1000);

    return () => {
      clearInterval(ticker);
      if (predictiveTimer) clearTimeout(predictiveTimer);
      predictiveScheduledRef.current = false;
      earlySwapDoneRef.current = false;
      setPrefetchStatus('idle');
    };
  }, [nowPlaying?.track_name, nowPlaying?.playback_state, nowPlaying?.duration_ms]);

  // 5s client polling for playback position (only while PLAYING)
  useEffect(() => {
    if (!isConnected || !showWidget) return;
    if (!nowPlaying?.track_name || nowPlaying.playback_state === 'PLAYBACK_STATE_IDLE') return;

    const poll = async () => {
      // Skip if a predictive poll just ran
      if (Date.now() - lastPredictivePollRef.current < PREDICTIVE_COOLDOWN_MS) return;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PLAYBACK_POLL_TIMEOUT);

      try {
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sonos-playback-status`,
          {
            headers: {
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
              'Content-Type': 'application/json',
            },
            signal: controller.signal,
          }
        );
        clearTimeout(timeout);

        if (!response.ok) return;
        const data = await response.json();
        if (!data.ok) return;

        localProgressRef.current = data.positionMillis;
        setLocalProgress(data.positionMillis);

        if (data.trackName) {
          setNowPlaying(prev => {
            if (!prev) return prev;
            const trackChanged = prev.track_name !== data.trackName;
            const artistChanged = prev.artist_name !== data.artistName;
            const albumChanged = prev.album_name !== data.albumName;
            if (!trackChanged && !artistChanged && !albumChanged && data.playbackState === prev.playback_state) {
              return prev;
            }
            if (trackChanged) {
              trackChangedAtRef.current = Date.now();
              // Don't use stale next_ URLs — keep current art, update text only
              // Trigger server sync to get correct art for the new track
              fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-sonos-now-playing`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
                  'Content-Type': 'application/json',
                },
              }).catch(() => {});
              return {
                ...prev,
                track_name: data.trackName,
                artist_name: data.artistName ?? prev.artist_name,
                album_name: data.albumName ?? prev.album_name,
                playback_state: data.playbackState,
                position_ms: data.positionMillis,
                next_album_art_url: null,
                next_bg_image_url: null,
              };
            }
            return {
              ...prev,
              track_name: data.trackName,
              artist_name: data.artistName ?? prev.artist_name,
              album_name: data.albumName ?? prev.album_name,
              playback_state: data.playbackState,
              position_ms: data.positionMillis,
            };
          });
        }

        if (data.playbackState !== 'PLAYBACK_STATE_PLAYING') {
          setNowPlaying(prev => prev ? { ...prev, playback_state: data.playbackState, position_ms: data.positionMillis } : prev);
        }

        // Safeguard: only correct background if current bgSentRef is NOT a known valid URL
        // Compare without query params to avoid cache-bust false positives
        const sentStripped = bgSentRef.current ? stripQuery(bgSentRef.current) : null;
        const isKnownValid = sentStripped && validBgBufferRef.current.some(u => stripQuery(u) === sentStripped);
        if (bgSentRef.current && !isKnownValid) {
          const expectedBgUrl = nowPlaying?.bg_image_url || displayedArtUrl;
          if (expectedBgUrl) {
            pushToBgBuffer(expectedBgUrl);
            onAlbumArtChangeRef.current?.(expectedBgUrl);
            bgSentRef.current = expectedBgUrl;
          }
        } else if (!bgSentRef.current && displayedArtUrl) {
          // Initial case: no bg sent yet but widget has art
          const bgUrl = nowPlaying?.bg_image_url || displayedArtUrl;
          pushToBgBuffer(bgUrl);
          onAlbumArtChangeRef.current?.(bgUrl);
          bgSentRef.current = bgUrl;
        }
      } catch {
        // ignore
      } finally {
        clearTimeout(timeout);
      }
    };

    poll();
    const interval = setInterval(poll, PLAYBACK_POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [isConnected, showWidget, nowPlaying?.track_name, nowPlaying?.playback_state]);

  // Check if connected and fetch initial data
  // Combined init: fetch settings + now playing in parallel
  useEffect(() => {
    const init = async () => {
      try {
        const [settingsResult, nowPlayingResult] = await Promise.all([
          (supabase as any)
            .from('sonos_settings')
            .select('show_on_dashboard, selected_group_id, track_change_offset_seconds')
            .limit(1)
            .maybeSingle(),
          (supabase as any)
            .from('sonos_now_playing')
            .select('track_name, artist_name, album_art_url, next_album_art_url, bg_image_url, next_bg_image_url, duration_ms, position_ms, playback_state')
            .limit(1)
            .maybeSingle(),
        ]);

        const { data: settings, error: settingsError } = settingsResult;

        if (settingsError || !settings?.selected_group_id) {
          setIsConnected(false);
          return;
        }

        setIsConnected(true);
        setShowWidget(settings?.show_on_dashboard ?? true);
        trackChangeOffsetRef.current = Number(settings?.track_change_offset_seconds) || 0;

        // Apply now playing data immediately (skip the second render cycle)
        const { data: npData, error: npError } = nowPlayingResult;
        if (npData && !npError && (settings?.show_on_dashboard ?? true)) {
          handleTrackUpdate(npData);
        }
      } catch (error) {
        console.error('[Sonos] Failed to init:', error);
        setIsConnected(false);
      }
    };

    init();
  }, [handleTrackUpdate]);

  // Wire up realtime callback - only apply if track matches or is newer
  useEffect(() => {
    if (!onRealtimeRef || !isConnected || !showWidget) return;
    onRealtimeRef.current = (payload: any) => {
      if (payload.new) {
        const incoming = payload.new as NowPlaying;
        setNowPlaying(prev => {
          if (!prev) return incoming;
          // After a local track change, ignore ALL realtime for 15s to let server catch up
          const msSinceTrackChange = Date.now() - trackChangedAtRef.current;
          if (msSinceTrackChange < 15000) {
            // Only accept bg_image_url if it's genuinely new (not stale from previous track)
          if (incoming.track_name === prev.track_name && incoming.bg_image_url && incoming.bg_image_url !== prev.bg_image_url) {
              const updatedBg = incoming.bg_image_url;
              pushToBgBuffer(updatedBg);
              onAlbumArtChangeRef.current?.(updatedBg);
              return { ...prev, bg_image_url: updatedBg, next_album_art_url: incoming.next_album_art_url || prev.next_album_art_url, next_bg_image_url: incoming.next_bg_image_url || prev.next_bg_image_url };
            }
            console.log(`[Sonos] Ignoring realtime during cooldown (${Math.round(msSinceTrackChange / 1000)}s): "${incoming.track_name}"`);
            return prev;
          }
          if (incoming.track_name !== prev.track_name) {
            console.log(`[Sonos] Ignoring stale realtime: DB has "${incoming.track_name}", local has "${prev.track_name}"`);
            return prev;
          }
          // Same track - merge in any new art URLs
          const updatedBg = incoming.bg_image_url || prev.bg_image_url;
          const bgChanged = updatedBg !== prev.bg_image_url;
          if (bgChanged) {
            pushToBgBuffer(updatedBg);
            onAlbumArtChangeRef.current?.(updatedBg);
          }
          return {
            ...prev,
            ...incoming,
            album_art_url: incoming.album_art_url || prev.album_art_url,
            bg_image_url: updatedBg,
          };
        });
        if (incoming.position_ms != null) {
          localProgressRef.current = incoming.position_ms;
          setLocalProgress(incoming.position_ms);
        }
      }
    };
    return () => { if (onRealtimeRef) onRealtimeRef.current = null; };
  }, [onRealtimeRef, isConnected, showWidget, setLocalProgress]);

  // Two-image approach: when new album_art_url arrives, preload it hidden
  // then swap displayedArtUrl once loaded
  const incomingArtUrl = nowPlaying?.album_art_url ?? null;
  const isNewArtPending = incomingArtUrl && incomingArtUrl !== displayedArtUrl && !imageError;

  // Track art loading status for debug dot
  useEffect(() => {
    if (isNewArtPending && currentArtStatus !== 'detecting') {
      setCurrentArtStatus('loading');
    }
  }, [isNewArtPending, currentArtStatus]);

  const handleNewImageLoaded = () => {
    setDisplayedArtUrl(incomingArtUrl);
    setImageError(false);
    setCurrentArtStatus('displayed'); // Green dot: image displayed
    // Only send bg if bgSentRef isn't already a valid (more recent) bg in the buffer
    const bgUrl = nowPlaying?.bg_image_url || incomingArtUrl;
    if (!bgSentRef.current || !validBgBufferRef.current.includes(bgSentRef.current) || bgSentRef.current === bgUrl) {
      pushToBgBuffer(bgUrl);
      onAlbumArtChangeRef.current?.(bgUrl);
      bgSentRef.current = bgUrl;
    }
  };

  const handleNewImageError = () => {
    // If new image fails, keep old displayedArtUrl
    setImageError(true);
  };

  // If first load and no displayedArtUrl yet, set it directly when data arrives
  useEffect(() => {
    if (incomingArtUrl && !displayedArtUrl && !imageError) {
      // First image - will be set via onLoad of the preloader
    }
  }, [incomingArtUrl, displayedArtUrl, imageError]);

  // Check if text needs scrolling (marquee)
  useEffect(() => {
    if (!textRef.current || !containerRef.current) return;

    const checkScroll = () => {
      if (textRef.current && containerRef.current) {
        setShouldScroll(textRef.current.scrollWidth > containerRef.current.clientWidth);
      }
    };

    checkScroll();
    window.addEventListener('resize', checkScroll);
    return () => window.removeEventListener('resize', checkScroll);
  }, [nowPlaying]);

  // Visibility logic: hide immediately if no data, grace period for IDLE/PAUSED
  const isInactive = !isConnected || !showWidget || !nowPlaying?.track_name;
  const wantsToHide = !isInactive && (nowPlaying?.playback_state === 'PLAYBACK_STATE_IDLE' || nowPlaying?.playback_state === 'PLAYBACK_STATE_PAUSED');

  useEffect(() => {
    if (isInactive) {
      if (hideGraceTimerRef.current) { clearTimeout(hideGraceTimerRef.current); hideGraceTimerRef.current = null; }
      setGraceExpired(true);
      onAlbumArtChangeRef.current?.(null);
      bgSentRef.current = null;
      validBgBufferRef.current = [];
      return;
    }
    if (wantsToHide) {
      if (!hideGraceTimerRef.current) {
        hideGraceTimerRef.current = setTimeout(() => {
          setGraceExpired(true);
          onAlbumArtChangeRef.current?.(null);
          bgSentRef.current = null;
          validBgBufferRef.current = [];
          hideGraceTimerRef.current = null;
        }, 5000);
      }
      return;
    }
    // Active (PLAYING/BUFFERING/TRANSITIONING) — cancel grace, show widget
    if (hideGraceTimerRef.current) { clearTimeout(hideGraceTimerRef.current); hideGraceTimerRef.current = null; }
    setGraceExpired(false);
  }, [isInactive, wantsToHide]);

  const shouldHide = isInactive || (wantsToHide && graceExpired);
  if (shouldHide) return null;

  // Calculate progress percentage
  const progressPercent = (localProgress && nowPlaying.duration_ms)
    ? Math.min((localProgress / nowPlaying.duration_ms) * 100, 100)
    : 0;

  // Fixed pixel sizes - always use TV sizes
  const trackFontSize = isMobile ? '0.8rem' : '18px';
  const artistFontSize = isMobile ? '0.7rem' : '14px';
  const progressHeight = isMobile ? '2px' : '5px';
  const widgetHeight = isMobile ? '56px' : '130px';
  const widgetWidth = isMobile ? '140px' : '280px';

  const hasAlbumArt = !!displayedArtUrl;

  return (
    <>
      <div
        className="relative overflow-hidden rounded-xl"
        style={{
          width: widgetWidth,
          height: widgetHeight,
          contain: 'strict',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 20px 50px -10px rgba(0, 0, 0, 0.25)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
        }}
      >
        {/* Fallback gradient background */}
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(135deg, hsl(var(--primary) / 0.9) 0%, hsl(var(--primary) / 0.7) 100%)',
          }}
        />

        {/* Image 1: Currently displayed album art (always visible) */}
        {displayedArtUrl && (
          <img
            src={displayedArtUrl}
            alt=""
            decoding="async"
            className="absolute inset-0 w-full h-full object-cover"
            style={{ opacity: 1 }}
          />
        )}

        {/* Image 2: New album art preloader (hidden until loaded, then swaps) */}
        {isNewArtPending && (
          <img
            src={incomingArtUrl!}
            alt=""
            decoding="async"
            className="absolute inset-0 w-full h-full object-cover"
            style={{ opacity: 0, pointerEvents: 'none' }}
            onLoad={handleNewImageLoaded}
            onError={handleNewImageError}
          />
        )}

        {/* Preload next track's album art (hidden, just for browser cache) */}
        {nowPlaying.next_album_art_url && nowPlaying.next_album_art_url !== displayedArtUrl && nowPlaying.next_album_art_url !== incomingArtUrl && (
          <img
            src={nowPlaying.next_album_art_url}
            alt=""
            decoding="async"
            onLoad={() => { if (prefetchStatus === 'ready') setPrefetchStatus('loaded'); }}
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
          />
        )}

        {/* Preload next track's background image */}
        {nowPlaying.next_bg_image_url && (
          <img
            src={nowPlaying.next_bg_image_url}
            alt=""
            decoding="async"
            onLoad={() => { if (prefetchStatus === 'ready') setPrefetchStatus('loaded'); }}
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
          />
        )}

        {/* Dark overlay for readability */}
        {hasAlbumArt && (
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(135deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.3) 100%)',
            }}
          />
        )}

        {/* Content */}
        <div
          className={`relative h-full flex flex-col justify-center ${
            isMobile ? 'px-3 py-2' : 'px-5 py-3'
          }`}
        >
          <div
            ref={containerRef}
            className="overflow-hidden"
          >
            <div
              ref={textRef}
              className="whitespace-nowrap font-semibold text-white drop-shadow-lg"
              style={{ fontSize: trackFontSize }}
            >
              {nowPlaying.track_name}
            </div>
          </div>
          {nowPlaying.artist_name && (
            <div
              className="truncate text-white/80 drop-shadow-md"
              style={{ fontSize: artistFontSize }}
            >
              {nowPlaying.artist_name}
            </div>
          )}

          {/* Progress Bar */}
          {nowPlaying.duration_ms && (
            <div
              className="w-full rounded-full overflow-hidden mt-3"
              style={{
                height: progressHeight,
                background: 'rgba(255, 255, 255, 0.2)',
              }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${progressPercent}%`,
                  background: 'rgba(255, 255, 255, 0.9)',
                  
                }}
              />
            </div>
          )}
          {/* Debug: Status indicators + time remaining */}
          {showDebug && (
            <div className="absolute top-1 right-1 flex items-center gap-1">
              {nowPlaying.duration_ms && localProgress !== null && (
                <span
                  className="text-white/70 font-mono"
                  style={{ fontSize: '10px', lineHeight: 1 }}
                >
                  {Math.max(0, Math.round((nowPlaying.duration_ms - localProgress) / 1000))}s
                </span>
              )}
              {/* Current art status: red=new track detected, orange=loading image, green=displayed */}
              {displayedArtUrl && (
                <div
                  title={`Current: ${currentArtStatus}`}
                  className="rounded-full"
                  style={{
                    width: 8,
                    height: 8,
                    background: currentArtStatus === 'detecting' ? '#ef4444'
                      : currentArtStatus === 'loading' ? '#f97316'
                      : '#22c55e',
                    boxShadow: `0 0 4px ${currentArtStatus === 'detecting' ? '#ef4444' : currentArtStatus === 'loading' ? '#f97316' : '#22c55e'}`,
                  }}
                />
              )}
              {/* Next track prefetch status */}
              {prefetchStatus !== 'idle' && (
                <div
                  title={`Next: ${prefetchStatus}`}
                  className="rounded-full"
                  style={{
                    width: 8,
                    height: 8,
                    background: prefetchStatus === 'fetching' ? '#f97316'
                      : prefetchStatus === 'ready' ? '#eab308'
                      : '#22c55e',
                    boxShadow: `0 0 4px ${prefetchStatus === 'fetching' ? '#f97316' : prefetchStatus === 'ready' ? '#eab308' : '#22c55e'}`,
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
});
