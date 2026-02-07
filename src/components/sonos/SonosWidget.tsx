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

  const onAlbumArtChangeRef = useRef(onAlbumArtChange);
  onAlbumArtChangeRef.current = onAlbumArtChange;
  const lastPredictivePollRef = useRef<number>(0);
  const predictiveScheduledRef = useRef(false);
  const prefetchTriggeredForTrackRef = useRef<string | null>(null);

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
    if (!nowPlaying?.track_name || nowPlaying.playback_state !== 'PLAYBACK_STATE_PLAYING' || !nowPlaying.duration_ms) return;

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
          setNowPlaying(prev => prev ? {
            ...prev,
            track_name: data.trackName,
            artist_name: data.artistName ?? prev.artist_name,
            album_name: data.albumName ?? prev.album_name,
            playback_state: data.playbackState,
            position_ms: data.positionMillis,
          } : prev);
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
      setPrefetchStatus('idle');
    };
  }, [nowPlaying?.track_name, nowPlaying?.playback_state, nowPlaying?.duration_ms]);

  // 5s client polling for playback position (only while PLAYING)
  useEffect(() => {
    if (!isConnected || !showWidget) return;
    if (!nowPlaying?.track_name || nowPlaying.playback_state !== 'PLAYBACK_STATE_PLAYING') return;

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
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const { data: settings, error: settingsError } = await (supabase as any)
          .from('sonos_settings')
          .select('show_on_dashboard, selected_group_id')
          .limit(1)
          .maybeSingle();

        if (settingsError || !settings?.selected_group_id) {
          setIsConnected(false);
          return;
        }

        setIsConnected(true);
        setShowWidget(settings?.show_on_dashboard ?? true);
      } catch (error) {
        console.error('[Sonos] Failed to check connection:', error);
        setIsConnected(false);
      }
    };

    checkConnection();
  }, []);

  // Initial fetch from database
  useEffect(() => {
    if (!isConnected || !showWidget) return;
    fetchNowPlaying();
  }, [isConnected, showWidget, fetchNowPlaying]);

  // Wire up realtime callback
  useEffect(() => {
    if (!onRealtimeRef || !isConnected || !showWidget) return;
    onRealtimeRef.current = (payload: any) => {
      if (payload.new) {
        handleTrackUpdate(payload.new as NowPlaying);
      }
    };
    return () => { if (onRealtimeRef) onRealtimeRef.current = null; };
  }, [onRealtimeRef, isConnected, showWidget, handleTrackUpdate]);

  // Two-image approach: when new album_art_url arrives, preload it hidden
  // then swap displayedArtUrl once loaded
  const incomingArtUrl = nowPlaying?.album_art_url ?? null;
  const isNewArtPending = incomingArtUrl && incomingArtUrl !== displayedArtUrl && !imageError;

  const handleNewImageLoaded = () => {
    setDisplayedArtUrl(incomingArtUrl);
    setImageError(false);
    // Send bg_image_url for dashboard background (pre-processed, no CSS filter needed)
    onAlbumArtChangeRef.current?.(nowPlaying?.bg_image_url || incomingArtUrl);
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

  // Clear background when not playing
  const shouldHide = !isConnected || !showWidget || !nowPlaying?.track_name || nowPlaying.playback_state !== 'PLAYBACK_STATE_PLAYING';
  
  useEffect(() => {
    if (shouldHide) {
      onAlbumArtChangeRef.current?.(null);
    }
  }, [shouldHide]);

  if (shouldHide) return null;

  // Calculate progress percentage
  const progressPercent = (localProgress && nowPlaying.duration_ms)
    ? Math.min((localProgress / nowPlaying.duration_ms) * 100, 100)
    : 0;

  // Fixed pixel sizes for scaled container
  const trackFontSize = isTvMode ? '18px' : isMobile ? '0.8rem' : '14px';
  const artistFontSize = isTvMode ? '14px' : isMobile ? '0.7rem' : '12px';
  const progressHeight = isTvMode ? '5px' : isMobile ? '2px' : '3px';
  const widgetHeight = isTvMode ? '130px' : isMobile ? '56px' : '70px';
  const widgetWidth = isTvMode ? '280px' : isMobile ? '140px' : '200px';

  const hasAlbumArt = !!displayedArtUrl;

  return (
    <>
      <div
        className={`relative overflow-hidden rounded-xl ${isTvMode ? '' : 'animate-fade-in'}`}
        style={{
          width: widgetWidth,
          height: widgetHeight,
          contain: 'strict',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 20px 50px -10px rgba(0, 0, 0, 0.25)',
          border: isTvMode ? '1px solid rgba(255, 255, 255, 0.15)' : 'none',
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
            isTvMode ? 'px-5 py-3' : isMobile ? 'px-3 py-2' : 'px-4 py-2'
          }`}
        >
          <div
            ref={containerRef}
            className="overflow-hidden"
          >
            <div
              ref={textRef}
              className={`whitespace-nowrap font-semibold text-white drop-shadow-lg ${
                shouldScroll && !isTvMode ? 'animate-marquee' : ''
              }`}
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
              className={`w-full rounded-full overflow-hidden ${isTvMode ? 'mt-3' : 'mt-2'}`}
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
                  ...(isTvMode ? {} : { transition: 'width 300ms linear' }),
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
                  style={{ fontSize: isTvMode ? '10px' : '8px', lineHeight: 1 }}
                >
                  {Math.max(0, Math.round((nowPlaying.duration_ms - localProgress) / 1000))}s
                </span>
              )}
              {/* Current art status: orange=loading, green=displayed */}
              {(isNewArtPending || displayedArtUrl) && (
                <div
                  title={isNewArtPending ? 'Current: loading' : 'Current: displayed'}
                  className="rounded-full"
                  style={{
                    width: isTvMode ? 8 : 6,
                    height: isTvMode ? 8 : 6,
                    background: isNewArtPending ? '#f97316' : '#22c55e',
                    boxShadow: `0 0 4px ${isNewArtPending ? '#f97316' : '#22c55e'}`,
                  }}
                />
              )}
              {/* Next track prefetch status */}
              {prefetchStatus !== 'idle' && (
                <div
                  title={`Next: ${prefetchStatus}`}
                  className="rounded-full"
                  style={{
                    width: isTvMode ? 8 : 6,
                    height: isTvMode ? 8 : 6,
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
