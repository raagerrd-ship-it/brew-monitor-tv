import { useState, useEffect, useRef } from 'react';
import { NowPlaying } from './types';

interface UseSonosVisibilityParams {
  isConnected: boolean;
  showWidget: boolean;
  nowPlaying: NowPlaying | null;
  onAlbumArtChangeRef: React.MutableRefObject<((url: string | null, trackName?: string) => void) | undefined>;
  bgSentRef: React.MutableRefObject<string | null>;
  validBgBufferRef: React.MutableRefObject<string[]>;
}

const PAUSE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Manages widget visibility with a 5-second grace period for IDLE state.
 * After 5 minutes of PAUSED, transitions to IDLE to stop polling and hide widget.
 * Uses a timestamp-based approach so repeated RT updates don't reset the timer.
 * Keeps widget visible during PAUSED, BUFFERING, TRANSITIONING.
 */
export function useSonosVisibility(params: UseSonosVisibilityParams) {
  const { isConnected, showWidget, nowPlaying, onAlbumArtChangeRef, bgSentRef, validBgBufferRef } = params;
  const [graceExpired, setGraceExpired] = useState(false);
  const hideGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pauseStartedAtRef = useRef<number | null>(null);
  const pauseCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pauseExpiredRef = useRef(false);

  const isInactive = !isConnected || !showWidget || !nowPlaying?.track_name || nowPlaying.track_name === 'TV Audio';
  const wantsToHide = !isInactive && nowPlaying?.playback_state === 'PLAYBACK_STATE_IDLE';
  const isPaused = !isInactive && nowPlaying?.playback_state === 'PLAYBACK_STATE_PAUSED';

  const clearAll = () => {
    onAlbumArtChangeRef.current?.(null);
    bgSentRef.current = null;
    validBgBufferRef.current = [];
  };

  // IDLE grace (5s)
  useEffect(() => {
    if (isInactive) {
      if (hideGraceTimerRef.current) { clearTimeout(hideGraceTimerRef.current); hideGraceTimerRef.current = null; }
      setGraceExpired(true);
      clearAll();
      return;
    }
    if (wantsToHide) {
      if (!hideGraceTimerRef.current) {
        hideGraceTimerRef.current = setTimeout(() => {
          setGraceExpired(true);
          clearAll();
          hideGraceTimerRef.current = null;
        }, 5000);
      }
      return;
    }
    if (hideGraceTimerRef.current) { clearTimeout(hideGraceTimerRef.current); hideGraceTimerRef.current = null; }
    setGraceExpired(false);
  }, [isInactive, wantsToHide]);

  // PAUSED timeout (5 min) — sets pauseExpiredRef directly (no state mutation)
  useEffect(() => {
    if (isPaused) {
      if (pauseStartedAtRef.current === null) {
        pauseStartedAtRef.current = Date.now();
        pauseExpiredRef.current = false;
        console.log('[Sonos:Visibility] Pause detected, starting 5-min countdown');
      }

      if (!pauseCheckRef.current) {
        pauseCheckRef.current = setInterval(() => {
          if (pauseStartedAtRef.current && !pauseExpiredRef.current) {
            const elapsed = Date.now() - pauseStartedAtRef.current;
            if (elapsed >= PAUSE_TIMEOUT_MS) {
              console.log(`[Sonos:Visibility] Paused for ${Math.round(elapsed / 1000)}s — hiding widget`);
              pauseExpiredRef.current = true;
              clearAll();
              // Force re-render so shouldHide picks up the ref change
              setGraceExpired(prev => !prev);
              if (pauseCheckRef.current) { clearInterval(pauseCheckRef.current); pauseCheckRef.current = null; }
            }
          }
        }, 10_000);
      }
      return;
    }

    // Not paused — reset
    pauseStartedAtRef.current = null;
    pauseExpiredRef.current = false;
    if (pauseCheckRef.current) { clearInterval(pauseCheckRef.current); pauseCheckRef.current = null; }
  }, [isPaused]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pauseCheckRef.current) { clearInterval(pauseCheckRef.current); pauseCheckRef.current = null; }
    };
  }, []);

  const shouldHide = isInactive || (wantsToHide && graceExpired) || (isPaused && pauseExpiredRef.current);
  return { shouldHide };
}
