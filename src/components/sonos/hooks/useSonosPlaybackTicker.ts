import { useEffect, useRef } from 'react';
import {
  NowPlaying, PrefetchStatus,
  PLAYBACK_POLL_TIMEOUT, PREDICTIVE_THRESHOLD_MS, PREDICTIVE_MARGIN_MS,
  PREDICTIVE_RETRY_INTERVAL_MS, PREDICTIVE_MAX_RETRIES,
  pushToBgBuffer, updateProgressDOM,
} from './types';

interface TrackChangeData {
  trackName: string;
  artistName?: string | null;
  albumName?: string | null;
  playbackState: string;
  positionMillis: number;
}

interface UseSonosPlaybackTickerParams {
  nowPlaying: NowPlaying | null;
  nowPlayingRef: React.MutableRefObject<NowPlaying | null>;
  setNowPlaying: React.Dispatch<React.SetStateAction<NowPlaying | null>>;
  setPrefetchStatus: (status: PrefetchStatus) => void;
  handleTrackChange: (data: TrackChangeData, earlySwapped: boolean) => void;
  addDebugLog?: (event: string) => void;
  localProgressRef: React.MutableRefObject<number | null>;
  trackChangedAtRef: React.MutableRefObject<number>;
  earlySwapDoneRef: React.MutableRefObject<boolean>;
  lastPredictivePollRef: React.MutableRefObject<number>;
  predictiveScheduledRef: React.MutableRefObject<boolean>;
  prefetchTriggeredForTrackRef: React.MutableRefObject<string | null>;
  trackChangeOffsetRef: React.MutableRefObject<number>;
  prefetchSecondsRef: React.MutableRefObject<number>;
  bgSentRef: React.MutableRefObject<string | null>;
  validBgBufferRef: React.MutableRefObject<string[]>;
  onAlbumArtChangeRef: React.MutableRefObject<((url: string | null) => void) | undefined>;
  progressBarRef: React.RefObject<HTMLDivElement | null>;
  debugTimeRef: React.RefObject<HTMLSpanElement | null>;
}

/**
 * 1-second ticker handling:
 * - Progress bar updates via DOM ref (zero re-renders)
 * - Predictive polling near track end
 * - Prefetch trigger for next track
 * - Early swap of images before track ends
 */
export function useSonosPlaybackTicker(params: UseSonosPlaybackTickerParams) {
  const {
    nowPlaying, nowPlayingRef, setNowPlaying, setPrefetchStatus, handleTrackChange,
    localProgressRef, trackChangedAtRef, earlySwapDoneRef,
    lastPredictivePollRef, predictiveScheduledRef, prefetchTriggeredForTrackRef,
    trackChangeOffsetRef, prefetchSecondsRef, bgSentRef, validBgBufferRef, onAlbumArtChangeRef,
    progressBarRef, debugTimeRef, addDebugLog,
  } = params;

  // Stable ref for handleTrackChange to avoid re-creating the effect
  const handleTrackChangeRef = useRef(handleTrackChange);
  handleTrackChangeRef.current = handleTrackChange;

  useEffect(() => {
    if (!nowPlaying?.track_name || nowPlaying.playback_state === 'PLAYBACK_STATE_IDLE' || !nowPlaying.duration_ms) return;

    const duration = nowPlaying.duration_ms;
    const trackName = nowPlaying.track_name;
    let predictiveTimer: ReturnType<typeof setTimeout> | null = null;
    let earlySwapRevertTimer: ReturnType<typeof setTimeout> | null = null;

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

        if (data.trackName && data.trackName !== trackName) {
          // Track confirmed changed — cancel any revert timer
          if (earlySwapRevertTimer) { clearTimeout(earlySwapRevertTimer); earlySwapRevertTimer = null; }
          addDebugLog?.(`🔄 Predictive poll confirmed: ${data.trackName}`);
          handleTrackChangeRef.current(data, earlySwapDoneRef.current);
        } else if (retriesLeft > 0) {
          predictiveTimer = setTimeout(() => pollForNewTrack(retriesLeft - 1), PREDICTIVE_RETRY_INTERVAL_MS);
        } else {
          // No track change after all retries — just sync position
          localProgressRef.current = data.positionMillis;
          updateProgressDOM(progressBarRef, debugTimeRef, data.positionMillis, duration);
        }
      } catch {
        // ignore
      }
    };

    const ticker = window.setInterval(() => {
      try {
        const prev = localProgressRef.current;
        if (prev === null) return;

        // Only advance progress when actually playing (not during PAUSED/BUFFERING)
        // Read from nowPlayingRef to avoid stale closure
        const currentState = nowPlayingRef?.current?.playback_state ?? nowPlaying.playback_state;
        const isPlaying = currentState === 'PLAYBACK_STATE_PLAYING';
        const next = isPlaying ? Math.min(prev + 1000, duration) : prev;
        localProgressRef.current = next;

        // Direct DOM update — zero React re-renders
        updateProgressDOM(progressBarRef, debugTimeRef, next, duration);

        const timeRemaining = duration - next;

        // Early swap: switch images AND text before track ends based on user offset
        const offsetMs = trackChangeOffsetRef.current * 1000;
        if (offsetMs > 0 && timeRemaining <= offsetMs && timeRemaining > 0 && !earlySwapDoneRef.current) {
          trackChangedAtRef.current = Date.now();
          addDebugLog?.(`⏩ Early swap triggered (${(timeRemaining / 1000).toFixed(1)}s left)`);
          setNowPlaying(prev => {
            if (!prev?.next_album_art_url) return prev;
            earlySwapDoneRef.current = true;
            setPrefetchStatus('loaded');
            console.log('[Sonos:BG] prefetchStatus: loaded (early swap)');
            const newArtUrl = prev.next_album_art_url || prev.album_art_url;
            const newBgUrl = prev.next_bg_image_url || prev.bg_image_url;
            const newWidgetArtUrl = prev.next_widget_art_url || prev.widget_art_url;
            const newTrackName = prev.next_track_name || prev.track_name;
            const newArtistName = prev.next_artist_name || prev.artist_name;
            console.log('[Sonos:BG] Early swap', {
              newArt: newArtUrl?.slice(-60),
              newBg: newBgUrl?.slice(-60),
              newWidget: newWidgetArtUrl?.slice(-60),
              newTrack: newTrackName,
              newArtist: newArtistName,
              timeRemaining: Math.round(timeRemaining),
            });
            pushToBgBuffer(validBgBufferRef.current, newBgUrl || newArtUrl);
            onAlbumArtChangeRef.current?.(newBgUrl || newArtUrl);
            bgSentRef.current = newBgUrl || newArtUrl;

            // Store originals for potential revert
            const origTrack = prev.track_name;
            const origArtist = prev.artist_name;

            // Set 15s revert timeout — if predictive poll doesn't confirm, revert text
            earlySwapRevertTimer = setTimeout(() => {
              console.log('[Sonos] Early swap revert: track change not confirmed within 15s');
              setNowPlaying(current => {
                if (!current) return current;
                // Only revert if still showing the early-swapped text
                if (current.track_name === newTrackName && current.artist_name === newArtistName) {
                  return { ...current, track_name: origTrack, artist_name: origArtist };
                }
                return current;
              });
              earlySwapRevertTimer = null;
            }, 15000);

            return {
              ...prev,
              track_name: newTrackName,
              artist_name: newArtistName,
              album_art_url: newArtUrl,
              bg_image_url: newBgUrl,
              widget_art_url: newWidgetArtUrl,
              next_album_art_url: null,
              next_bg_image_url: null,
              next_widget_art_url: null,
              next_track_name: null,
              next_artist_name: null,
            };
          });
        }

        // Prefetch: trigger server sync before end (once per track)
        if (timeRemaining <= prefetchSecondsRef.current * 1000 && timeRemaining > 0 && prefetchTriggeredForTrackRef.current !== trackName) {
          prefetchTriggeredForTrackRef.current = trackName;
          setPrefetchStatus('fetching');
          addDebugLog?.(`🔴 Prefetch: server sync started (${Math.round(timeRemaining / 1000)}s left)`);
          console.log(`[Sonos:BG] prefetchStatus: fetching (${Math.round(timeRemaining / 1000)}s remaining)`);
          const ac = new AbortController();
          const t = setTimeout(() => ac.abort(), 15000);
          fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-sonos-now-playing`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
              'Content-Type': 'application/json',
            },
            signal: ac.signal,
          }).then(async res => {
            if (res.ok) {
              const body = await res.json().catch(() => ({}));
              const dur = body.duration_ms ? `${body.duration_ms}ms` : '?';
              setPrefetchStatus('ready');
              addDebugLog?.(`🟡 Prefetch: server done (${dur} img processing)`);
              console.log('[Sonos:BG] prefetchStatus: ready');
            }
          })
            .catch(() => {})
            .finally(() => clearTimeout(t));
        }

        // Predictive poll: schedule when <10s remain (once per track)
        if (timeRemaining <= PREDICTIVE_THRESHOLD_MS && timeRemaining > 0 && !predictiveScheduledRef.current) {
          predictiveScheduledRef.current = true;
          const delay = Math.max(timeRemaining + PREDICTIVE_MARGIN_MS, 100);
          addDebugLog?.(`🔮 Predictive poll scheduled in ${(delay / 1000).toFixed(1)}s`);
          predictiveTimer = setTimeout(() => pollForNewTrack(PREDICTIVE_MAX_RETRIES), delay);
        }
      } catch (err) {
        console.error('[Sonos] Ticker error:', err);
      }
    }, 1000);

    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    return () => {
      clearInterval(ticker);
      if (predictiveTimer) clearTimeout(predictiveTimer);
      if (earlySwapRevertTimer) clearTimeout(earlySwapRevertTimer);
      if (idleTimer) clearTimeout(idleTimer);
      predictiveScheduledRef.current = false;
      earlySwapDoneRef.current = false;
      // Delay idle reset so the green "loaded" dot is visible briefly after track change
      idleTimer = setTimeout(() => setPrefetchStatus('idle'), 2000);
    };
  }, [nowPlaying?.track_name, nowPlaying?.playback_state, nowPlaying?.duration_ms]);
}
