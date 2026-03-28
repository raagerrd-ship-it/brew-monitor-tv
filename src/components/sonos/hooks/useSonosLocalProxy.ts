import { useEffect, useRef } from 'react';
import { NowPlaying, updateProgressDOM } from './types';
import { tvDebug } from '@/lib/tv-debug-log';

const DEFAULT_LOCAL_PROXY_URL = 'http://192.168.1.11:3000/api/sonos';
const LOCAL_POLL_INTERVAL = 30000;
const LOCAL_POLL_TIMEOUT = 4000;
const SSE_STALE_MS = 5000;

function getLocalProxyUrl(): string {
  try {
    const stored = localStorage.getItem('sonosLocalProxy');
    const url = (stored || DEFAULT_LOCAL_PROXY_URL).trim().replace(/\/status\/?$/, '').replace(/\/$/, '');
    if (!stored) localStorage.setItem('sonosLocalProxy', url);
    return url;
  } catch {
    return DEFAULT_LOCAL_PROXY_URL;
  }
}

interface TrackChangeData {
  trackName: string;
  artistName?: string | null;
  albumName?: string | null;
  playbackState: string;
  positionMillis: number;
}

interface UseSonosLocalProxyParams {
  isConnected: boolean;
  showWidget: boolean;
  nowPlaying: NowPlaying | null;
  nowPlayingRef: React.MutableRefObject<NowPlaying | null>;
  setNowPlaying: React.Dispatch<React.SetStateAction<NowPlaying | null>>;
  handleTrackChange: (data: TrackChangeData) => void;
  localProgressRef: React.MutableRefObject<number | null>;
  trackChangedAtRef: React.MutableRefObject<number>;
  progressBarRef: React.RefObject<HTMLDivElement | null>;
  debugTimeRef: React.RefObject<HTMLSpanElement | null>;
}

/**
 * Hybrid local proxy hook: uses SSE (primary) + fallback poll from Cast Away
 * for fast pause/play/skip detection. Art/background still comes from cloud RT.
 */
export function useSonosLocalProxy(params: UseSonosLocalProxyParams) {
  const {
    isConnected, showWidget, nowPlaying, nowPlayingRef,
    setNowPlaying, handleTrackChange,
    localProgressRef, trackChangedAtRef,
    progressBarRef, debugTimeRef,
  } = params;

  const localActiveRef = useRef(false);
  const handleTrackChangeRef = useRef(handleTrackChange);
  handleTrackChangeRef.current = handleTrackChange;

  useEffect(() => {
    if (!isConnected || !showWidget) {
      localActiveRef.current = false;
      return;
    }

    const proxyUrl = getLocalProxyUrl();
    if (!proxyUrl) {
      localActiveRef.current = false;
      return;
    }

    let lastSseMessage = 0;
    let es: EventSource | null = null;
    let pollId: ReturnType<typeof setInterval> | null = null;

    const applyLocalStatus = (s: any) => {
      if (!s?.ok && !s?.trackName && !s?.playbackState) return;

      const current = nowPlayingRef.current;
      const incomingState = s.playbackState;
      const incomingTrack = s.trackName;

      // State-only update (no track name) — e.g. pause/stop
      if (!incomingTrack) {
        if (incomingState && current && current.playback_state !== incomingState) {
          tvDebug('sonos', `📡 Local: state ${current.playback_state} → ${incomingState}`);
          setNowPlaying(prev => prev ? { ...prev, playback_state: incomingState } : prev);
        }
        return;
      }

      // Track change
      const msSinceTC = Date.now() - trackChangedAtRef.current;
      if (current && incomingTrack !== current.track_name && msSinceTC >= 10000) {
        tvDebug('sonos', `📡 Local: track change → "${incomingTrack}"`);
        handleTrackChangeRef.current({
          trackName: incomingTrack,
          artistName: s.artistName,
          albumName: s.albumName,
          playbackState: incomingState ?? 'PLAYBACK_STATE_PLAYING',
          positionMillis: s.positionMillis ?? 0,
        });
        return;
      }

      // Position sync + state
      if (current && incomingTrack === current.track_name) {
        if (s.positionMillis != null) {
          const drift = Math.abs(s.positionMillis - (localProgressRef.current ?? 0));
          if (drift > 3000) {
            localProgressRef.current = s.positionMillis;
            updateProgressDOM(progressBarRef, debugTimeRef, s.positionMillis, current.duration_ms);
          }
        }
        if (incomingState && current.playback_state !== incomingState) {
          setNowPlaying(prev => prev ? { ...prev, playback_state: incomingState } : prev);
        }
      }
    };

    // SSE connection (primary)
    const connectSSE = () => {
      try {
        es = new EventSource(`${proxyUrl}/events`);
        es.onmessage = (e) => {
          lastSseMessage = Date.now();
          localActiveRef.current = true;
          try {
            const s = JSON.parse(e.data);
            applyLocalStatus(s);
          } catch { /* ignore */ }
        };
        es.onerror = () => {
          // EventSource auto-reconnects
        };
        tvDebug('sonos', `📡 Local SSE connected: ${proxyUrl}/events`);
      } catch {
        tvDebug('sonos', `📡 Local SSE failed to connect`);
      }
    };

    connectSSE();

    // Fallback poll (only when SSE is stale)
    const pollLocal = async () => {
      if (Date.now() - lastSseMessage < SSE_STALE_MS) return;
      try {
        const res = await fetch(`${proxyUrl}/status`, { signal: AbortSignal.timeout(LOCAL_POLL_TIMEOUT) });
        if (res.ok) {
          localActiveRef.current = true;
          const s = await res.json();
          applyLocalStatus(s);
        }
      } catch {
        // Local proxy unreachable — cloud will handle it
        localActiveRef.current = false;
      }
    };

    pollId = setInterval(pollLocal, LOCAL_POLL_INTERVAL);

    return () => {
      if (es) { es.close(); es = null; }
      if (pollId) { clearInterval(pollId); pollId = null; }
      localActiveRef.current = false;
    };
  }, [isConnected, showWidget]);

  return { localActiveRef };
}
