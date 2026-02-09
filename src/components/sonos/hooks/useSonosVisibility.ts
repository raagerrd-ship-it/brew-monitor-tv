import { useState, useEffect, useRef } from 'react';
import { NowPlaying } from './types';

interface UseSonosVisibilityParams {
  isConnected: boolean;
  showWidget: boolean;
  nowPlaying: NowPlaying | null;
  onAlbumArtChangeRef: React.MutableRefObject<((url: string | null) => void) | undefined>;
  bgSentRef: React.MutableRefObject<string | null>;
  validBgBufferRef: React.MutableRefObject<string[]>;
}

/**
 * Manages widget visibility with a 5-second grace period for IDLE state.
 * Keeps widget visible during PAUSED, BUFFERING, TRANSITIONING.
 */
export function useSonosVisibility(params: UseSonosVisibilityParams) {
  const { isConnected, showWidget, nowPlaying, onAlbumArtChangeRef, bgSentRef, validBgBufferRef } = params;
  const [graceExpired, setGraceExpired] = useState(false);
  const hideGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [pauseExpired, setPauseExpired] = useState(false);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const PAUSE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

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

  // PAUSED timeout (5 min)
  useEffect(() => {
    if (isPaused) {
      if (!pauseTimerRef.current) {
        pauseTimerRef.current = setTimeout(() => {
          console.log('[Sonos:Visibility] Paused for 5 min — hiding widget');
          setPauseExpired(true);
          clearAll();
          pauseTimerRef.current = null;
        }, PAUSE_TIMEOUT_MS);
      }
      return;
    }
    // Not paused — reset
    if (pauseTimerRef.current) { clearTimeout(pauseTimerRef.current); pauseTimerRef.current = null; }
    setPauseExpired(false);
  }, [isPaused]);

  const shouldHide = isInactive || (wantsToHide && graceExpired) || (isPaused && pauseExpired);
  return { shouldHide };
}
