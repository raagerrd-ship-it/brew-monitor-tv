import { useEffect, useRef } from 'react';
import { tvDebug } from '@/lib/tv-debug-log';
import {
  NowPlaying,
  PLAYBACK_POLL_TIMEOUT, PREDICTIVE_THRESHOLD_MS, PREDICTIVE_MARGIN_MS,
  PREDICTIVE_RETRY_INTERVAL_MS, PREDICTIVE_MAX_RETRIES,
  triggerServerSync,
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
  handleTrackChange: (data: TrackChangeData) => void;
  localProgressRef: React.MutableRefObject<number | null>;
  trackChangedAtRef: React.MutableRefObject<number>;
  lastPredictivePollRef: React.MutableRefObject<number>;
  predictiveScheduledRef: React.MutableRefObject<boolean>;
  trackChangeOffsetRef: React.MutableRefObject<number>;
  progressBarRef: React.RefObject<HTMLDivElement | null>;
  debugTimeRef: React.RefObject<HTMLSpanElement | null>;
}

/**
 * 1s ticker: progress bar + predictive swap.
 * ≤15s: eager sync if next images missing
 * ≤10s: schedule swap
 * Swap: use next_* if available, else poll
 */
export function useSonosPlaybackTicker(params: UseSonosPlaybackTickerParams) {
  const {
    nowPlaying, nowPlayingRef, handleTrackChange,
    localProgressRef, trackChangedAtRef,
    lastPredictivePollRef, predictiveScheduledRef, trackChangeOffsetRef,
    progressBarRef, debugTimeRef,
  } = params;

  const handleTrackChangeRef = useRef(handleTrackChange);
  handleTrackChangeRef.current = handleTrackChange;
  const eagerSyncDoneRef = useRef(false);

  useEffect(() => {
    if (!nowPlaying?.track_name || nowPlaying.playback_state === 'PLAYBACK_STATE_IDLE' || !nowPlaying.duration_ms) return;

    const duration = nowPlaying.duration_ms;
    const trackName = nowPlaying.track_name;
    let predictiveTimer: ReturnType<typeof setTimeout> | null = null;
    eagerSyncDoneRef.current = false;

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
          handleTrackChangeRef.current(data);
        } else if (retriesLeft > 0) {
          predictiveTimer = setTimeout(() => pollForNewTrack(retriesLeft - 1), PREDICTIVE_RETRY_INTERVAL_MS);
        } else {
          localProgressRef.current = data.positionMillis;
          updateProgressDOM(progressBarRef, debugTimeRef, data.positionMillis, duration);
        }
      } catch { /* ignore */ }
    };

    const ticker = window.setInterval(() => {
      const prev = localProgressRef.current;
      if (prev === null) return;

      const currentState = nowPlayingRef?.current?.playback_state ?? nowPlaying.playback_state;
      const isPlaying = currentState === 'PLAYBACK_STATE_PLAYING';
      const next = isPlaying ? Math.min(prev + 1000, duration) : prev;
      localProgressRef.current = next;
      updateProgressDOM(progressBarRef, debugTimeRef, next, duration);

      const remaining = duration - next;

      // Eager sync: ≤15s, trigger server sync if next images missing
      if (remaining <= 15000 && remaining > 0 && !eagerSyncDoneRef.current) {
        eagerSyncDoneRef.current = true;
        const current = nowPlayingRef?.current;
        if (!current?.next_bg_image_url) {
          tvDebug('sonos', `🔮 ${Math.round(remaining / 1000)}s kvar — eager sync`);
          triggerServerSync().catch(() => {});
        }
      }

      // Predictive swap: ≤10s, schedule
      const offsetMs = trackChangeOffsetRef.current > 0
        ? trackChangeOffsetRef.current * 1000
        : PREDICTIVE_MARGIN_MS;

      if (remaining <= PREDICTIVE_THRESHOLD_MS && remaining > 0 && !predictiveScheduledRef.current) {
        predictiveScheduledRef.current = true;
        const delay = Math.max(remaining - offsetMs, 100);
        tvDebug('sonos', `🔮 Swap om ${(delay / 1000).toFixed(1)}s`);

        // Preload next images
        const current = nowPlayingRef?.current;
        [current?.next_widget_art_url, current?.next_bg_image_url]
          .filter(Boolean)
          .forEach(url => { const img = new Image(); img.src = url!; });

        predictiveTimer = setTimeout(() => {
          const snap = nowPlayingRef?.current;
          if (snap?.next_track_name) {
            tvDebug('sonos', `🔮 Swap → "${snap.next_track_name}"`);
            if (snap.next_bg_image_url) { const img = new Image(); img.src = snap.next_bg_image_url; }
            handleTrackChangeRef.current({
              trackName: snap.next_track_name,
              artistName: snap.next_artist_name,
              playbackState: 'PLAYBACK_STATE_PLAYING',
              positionMillis: 0,
            });
          } else {
            tvDebug('sonos', `🔮 Ingen next-data — pollar`);
            pollForNewTrack(PREDICTIVE_MAX_RETRIES);
          }
        }, delay);
      }
    }, 1000);

    return () => {
      clearInterval(ticker);
      if (predictiveTimer) clearTimeout(predictiveTimer);
      predictiveScheduledRef.current = false;
    };
  }, [nowPlaying?.track_name, nowPlaying?.playback_state, nowPlaying?.duration_ms]);
}
