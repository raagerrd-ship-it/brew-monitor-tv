import { useEffect, useRef } from 'react';
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
 * 30s poll for position sync + next track metadata + pause resume detection.
 * Uses monotonic seq-gate to reject stale data.
 *
 * The effect starts/stops based on isConnected, showWidget, and whether
 * there is an active playing track. Track name and playback state changes
 * are tracked via refs to avoid tearing down the interval on every RT update.
 */
export function useSonosClientPolling(params: UseSonosClientPollingParams) {
  const {
    isConnected, showWidget, nowPlaying, nowPlayingRef,
    setNowPlaying, handleTrackChange,
    localProgressRef, lastPredictivePollRef,
    progressBarRef, debugTimeRef,
    acceptedSeqRef, swappedFromRef,
  } = params;

  // Derive "should poll" and debounce via ref so the effect only
  // re-runs when the value actually changes (prevents spurious restarts
  // when setNowPlaying triggers a re-render with the same logical state).
  const rawIsActive = !!(
    isConnected && showWidget &&
    nowPlaying?.track_name &&
    nowPlaying.playback_state !== 'PLAYBACK_STATE_IDLE' &&
    nowPlaying.playback_state !== 'PLAYBACK_STATE_PAUSED'
  );

  const [stableIsActive, setStableIsActive] = useState(rawIsActive);
  const prevRawRef = useRef(rawIsActive);
  if (prevRawRef.current !== rawIsActive) {
    prevRawRef.current = rawIsActive;
    // Only update state (and thus re-run effect) when the boolean actually flips
    setStableIsActive(rawIsActive);
  }

  // Keep a ref so the poll closure always reads the latest nowPlaying
  const nowPlayingLatestRef = useRef(nowPlaying);
  nowPlayingLatestRef.current = nowPlaying;

  useEffect(() => {
    if (!stableIsActive) return;

    const np = nowPlayingLatestRef.current;
    tvDebug('sonos', `▶️ Klient-poll startad (state: ${np?.playback_state}, track: "${np?.track_name}")`);

    const poll = async () => {
      const current = nowPlayingLatestRef.current;
      if (!current) return;

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

        const sonosPos = data.positionMillis ?? 0;
        const appPos = localProgressRef.current ?? 0;
        const diff = appPos - sonosPos;
        const duration = data.durationMillis ?? current.duration_ms;
        const currentTrack = nowPlayingRef.current?.track_name ?? current.track_name;
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

        if (!data.trackName) {
          if (data.playbackState === 'PLAYBACK_STATE_IDLE' && data.positionMillis === 0) return;
          if (data.playbackState !== current.playback_state) {
            setNowPlaying(prev => prev ? { ...prev, playback_state: data.playbackState } : prev);
          }
          return;
        }

        // Transient IDLE during skip
        const isTransientIdle = data.playbackState === 'PLAYBACK_STATE_IDLE' && data.positionMillis === 0;

        const latest = nowPlayingRef.current;
        const trackChanged = (latest?.track_name ?? current.track_name) !== data.trackName;

        if (trackChanged) {
          if (!isTransientIdle) {
            const swapped = swappedFromRef.current;
            const recentSwap = swapped && (Date.now() - swapped.ts) < 15_000;
            if (recentSwap) {
              tvDebug('sonos', `🔒 Poll: suppressed server sync (recent swap ${((Date.now() - swapped!.ts) / 1000).toFixed(1)}s ago)`);
            } else {
              tvDebug('sonos', `🔄 Poll detected track change → triggering server sync`);
              triggerServerSync();
            }
          }
        } else {
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
    return () => {
      tvDebug('sonos', `⏸️ Klient-poll stoppad (state: ${nowPlayingLatestRef.current?.playback_state})`);
      clearInterval(interval);
    };
  }, [stableIsActive]);
}
