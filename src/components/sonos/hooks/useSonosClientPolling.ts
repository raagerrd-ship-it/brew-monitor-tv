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
    if (!nowPlaying?.track_name || nowPlaying.playback_state === 'PLAYBACK_STATE_IDLE' || nowPlaying.playback_state === 'PLAYBACK_STATE_PAUSED') return;

    tvDebug('sonos', `▶️ Klient-poll startad (state: ${nowPlaying.playback_state}, track: "${nowPlaying.track_name}")`);

    const shouldSyncPlayback = PLAYBACK_POLL_INTERVAL > 0;
    const intervalMs = shouldSyncPlayback ? PLAYBACK_POLL_INTERVAL : 10_000;

    const poll = async () => {
      if (shouldSyncPlayback && Date.now() - lastPredictivePollRef.current < PREDICTIVE_COOLDOWN_MS) return;

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

        const sonosPos = data.positionMillis ?? 0;
        const appPos = localProgressRef.current ?? 0;
        const diff = appPos - sonosPos;
        const duration = data.durationMillis ?? nowPlaying.duration_ms;
        const currentTrack = nowPlayingRef.current?.track_name ?? nowPlaying.track_name;
        const isStaleSeq = isSeqStale(acceptedSeqRef.current, data.trackSeq);
        const isTrackMismatch = !!(currentTrack && data.trackName && data.trackName !== currentTrack);

        if (isStaleSeq) {
          tvDebug('sonos', `🔒 Sonos direkt ignorerad: seq ${data.trackSeq} < accepted ${acceptedSeqRef.current}`);
          return;
        }

        if (!isTrackMismatch) {
          const appRemaining = duration ? Math.round((duration - appPos) / 1000) : '?';
          const sonosRemaining = duration ? Math.round((duration - sonosPos) / 1000) : '?';
          tvDebug('sonos', `📊 Sonos direkt — App: -${appRemaining}s | Sonos: -${sonosRemaining}s | Drift: ${diff >= 0 ? '+' : ''}${(diff / 1000).toFixed(1)}s`);
          localProgressRef.current = sonosPos;
          updateProgressDOM(progressBarRef, debugTimeRef, sonosPos, duration);
        } else {
          tvDebug('sonos', `🔒 Sonos direkt ignorerad: "${data.trackName}" ≠ "${currentTrack}"`);
        }

        if (!shouldSyncPlayback) return;

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
            // Suppress server sync if we recently did a predictive swap (avoids stale revert)
            const swapped = swappedFromRef.current;
            const recentSwap = swapped && (Date.now() - swapped.ts) < 15_000;
            if (recentSwap) {
              tvDebug('sonos', `🔒 Poll: suppressed server sync (recent swap ${((Date.now() - swapped!.ts) / 1000).toFixed(1)}s ago)`);
            } else {
              tvDebug('sonos', `🔄 Poll detected track change → triggering server sync`);
              triggerServerSync();
            }
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
    const interval = setInterval(poll, intervalMs);
    return () => {
      tvDebug('sonos', `⏸️ Klient-poll stoppad (state: ${nowPlaying.playback_state})`);
      clearInterval(interval);
    };
  }, [isConnected, showWidget, nowPlaying?.track_name, nowPlaying?.playback_state]);
}
