import { useEffect } from 'react';
import { tvDebug } from '@/lib/tv-debug-log';
import {
  NowPlaying, isSeqStale,
  PLAYBACK_POLL_INTERVAL, PLAYBACK_POLL_TIMEOUT, PREDICTIVE_COOLDOWN_MS,
  updateProgressDOM, triggerServerSync,
} from './types';

interface TrackChangeData {
  trackName: string;
  artistName?: string | null;
  albumName?: string | null;
  playbackState: string;
  positionMillis: number;
}

interface UseSonosClientPollingParams {
  isConnected: boolean;
  showWidget: boolean;
  nowPlaying: NowPlaying | null;
  nowPlayingRef: React.MutableRefObject<NowPlaying | null>;
  setNowPlaying: React.Dispatch<React.SetStateAction<NowPlaying | null>>;
  handleTrackChange: (data: TrackChangeData) => void;
  localProgressRef: React.MutableRefObject<number | null>;
  lastPredictivePollRef: React.MutableRefObject<number>;
  progressBarRef: React.RefObject<HTMLDivElement | null>;
  debugTimeRef: React.RefObject<HTMLSpanElement | null>;
  acceptedSeqRef: React.MutableRefObject<number>;
  swappedFromRef: React.MutableRefObject<{ trackName: string; ts: number } | null>;
}

/**
 * 5s poll for position sync + next track metadata + pause resume detection.
 * Uses monotonic seq-gate to reject stale data.
 */
export function useSonosClientPolling(params: UseSonosClientPollingParams) {
  const {
    isConnected, showWidget, nowPlaying, nowPlayingRef,
    setNowPlaying, handleTrackChange,
    localProgressRef, lastPredictivePollRef,
    progressBarRef, debugTimeRef,
    acceptedSeqRef, swappedFromRef,
  } = params;

  useEffect(() => {
    if (!isConnected || !showWidget) return;
    if (!nowPlaying?.track_name || nowPlaying.playback_state === 'PLAYBACK_STATE_IDLE') return;

    const poll = async () => {
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

        // Seq-gate: reject stale data before any processing
        if (isSeqStale(acceptedSeqRef.current, data.trackSeq)) {
          tvDebug('sonos', `🔒 Poll rejected: seq ${data.trackSeq} < accepted ${acceptedSeqRef.current}`);
          return;
        }

        // Position drift correction (>3s)
        const drift = Math.abs(data.positionMillis - (localProgressRef.current ?? 0));
        if (drift > 3000) localProgressRef.current = data.positionMillis;

        const duration = data.durationMillis ?? nowPlaying.duration_ms;
        updateProgressDOM(progressBarRef, debugTimeRef, localProgressRef.current ?? data.positionMillis, duration);

        if (!data.trackName) {
          if (data.playbackState === 'PLAYBACK_STATE_IDLE' && data.positionMillis === 0) return;
          if (data.playbackState !== nowPlaying.playback_state) {
            setNowPlaying(prev => prev ? { ...prev, playback_state: data.playbackState } : prev);
          }
          return;
        }

        // Transient IDLE during skip
        const isTransientIdle = data.playbackState === 'PLAYBACK_STATE_IDLE' && data.positionMillis === 0;

        const current = nowPlayingRef.current;
        const trackChanged = (current?.track_name ?? nowPlaying.track_name) !== data.trackName;

        if (trackChanged) {
          if (!isTransientIdle) {
            tvDebug('sonos', `🔄 Poll detected track change → triggering server sync`);
            triggerServerSync();
          }
        } else if (!trackChanged) {
          // Same track — only sync state + duration
          setNowPlaying(prev => {
            if (!prev) return prev;
            const effectiveState = isTransientIdle ? prev.playback_state : data.playbackState;
            const stateChanged = prev.playback_state !== effectiveState;
            const durationChanged = duration && prev.duration_ms !== duration;

            if (!stateChanged && !durationChanged) return prev;

            return {
              ...prev,
              playback_state: effectiveState,
              duration_ms: duration ?? prev.duration_ms,
            };
          });
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
}
