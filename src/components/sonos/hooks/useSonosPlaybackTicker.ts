import { useEffect, useRef } from 'react';
import {
  NowPlaying, PrefetchStatus,
  PLAYBACK_POLL_TIMEOUT, PREDICTIVE_THRESHOLD_MS, PREDICTIVE_MARGIN_MS,
  PREDICTIVE_RETRY_INTERVAL_MS, PREDICTIVE_MAX_RETRIES,
  updateProgressDOM,
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
  handleTrackChange: (data: TrackChangeData) => void;
  addDebugLog?: (event: string) => void;
  localProgressRef: React.MutableRefObject<number | null>;
  trackChangedAtRef: React.MutableRefObject<number>;
  lastPredictivePollRef: React.MutableRefObject<number>;
  predictiveScheduledRef: React.MutableRefObject<boolean>;
  prefetchTriggeredForTrackRef: React.MutableRefObject<string | null>;
  prefetchSecondsRef: React.MutableRefObject<number>;
  progressBarRef: React.RefObject<HTMLDivElement | null>;
  debugTimeRef: React.RefObject<HTMLSpanElement | null>;
}

/**
 * 1-second ticker handling:
 * - Progress bar updates via DOM ref (zero re-renders)
 * - Predictive polling near track end
 * - Prefetch trigger for warm-caching current track images on server
 */
export function useSonosPlaybackTicker(params: UseSonosPlaybackTickerParams) {
  const {
    nowPlaying, nowPlayingRef, setNowPlaying, setPrefetchStatus, handleTrackChange,
    localProgressRef, trackChangedAtRef,
    lastPredictivePollRef, predictiveScheduledRef, prefetchTriggeredForTrackRef,
    prefetchSecondsRef,
    progressBarRef, debugTimeRef, addDebugLog,
  } = params;

  const handleTrackChangeRef = useRef(handleTrackChange);
  handleTrackChangeRef.current = handleTrackChange;

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

        if (data.trackName && data.trackName !== trackName) {
          addDebugLog?.(`🔄 Predictive poll confirmed: ${data.trackName}`);
          handleTrackChangeRef.current(data);
        } else if (retriesLeft > 0) {
          predictiveTimer = setTimeout(() => pollForNewTrack(retriesLeft - 1), PREDICTIVE_RETRY_INTERVAL_MS);
        } else {
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

        const currentState = nowPlayingRef?.current?.playback_state ?? nowPlaying.playback_state;
        const isPlaying = currentState === 'PLAYBACK_STATE_PLAYING';
        const next = isPlaying ? Math.min(prev + 1000, duration) : prev;
        localProgressRef.current = next;

        updateProgressDOM(progressBarRef, debugTimeRef, next, duration);

        const timeRemaining = duration - next;

        // Prefetch: trigger server sync to warm-cache CURRENT track's images
        if (timeRemaining <= prefetchSecondsRef.current * 1000 && timeRemaining > 0 && prefetchTriggeredForTrackRef.current !== trackName) {
          prefetchTriggeredForTrackRef.current = trackName;
          setPrefetchStatus('fetching');
          addDebugLog?.(`🔴 Prefetch: server warm-cache started (${Math.round(timeRemaining / 1000)}s left)`);
          console.log(`[Sonos:BG] prefetchStatus: fetching (warm-cache, ${Math.round(timeRemaining / 1000)}s remaining)`);
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
              addDebugLog?.(`🟡 Prefetch: server done (${dur})`);
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
      if (idleTimer) clearTimeout(idleTimer);
      predictiveScheduledRef.current = false;
      idleTimer = setTimeout(() => setPrefetchStatus('idle'), 2000);
    };
  }, [nowPlaying?.track_name, nowPlaying?.playback_state, nowPlaying?.duration_ms]);
}
