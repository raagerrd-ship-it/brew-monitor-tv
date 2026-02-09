import { useState, useEffect, useRef } from 'react';
import { NowPlaying } from './types';

interface UseSonosVisibilityParams {
  isConnected: boolean;
  showWidget: boolean;
  nowPlaying: NowPlaying | null;
  setNowPlaying: React.Dispatch<React.SetStateAction<NowPlaying | null>>;
  onAlbumArtChangeRef: React.MutableRefObject<((url: string | null) => void) | undefined>;
  bgSentRef: React.MutableRefObject<string | null>;
  validBgBufferRef: React.MutableRefObject<string[]>;
}

const PAUSE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Manages widget visibility with a 5-second grace period for IDLE state.
 * After 5 minutes of PAUSED, transitions to IDLE to stop polling and hide widget.
 * Keeps widget visible during PAUSED, BUFFERING, TRANSITIONING.
 */
export function useSonosVisibility(params: UseSonosVisibilityParams) {
  const { isConnected, showWidget, nowPlaying, setNowPlaying, onAlbumArtChangeRef, bgSentRef, validBgBufferRef } = params;
  const [graceExpired, setGraceExpired] = useState(false);
  const hideGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // PAUSED timeout (5 min) — transition to IDLE to stop all polling
  useEffect(() => {
    if (isPaused) {
      if (!pauseTimerRef.current) {
        pauseTimerRef.current = setTimeout(() => {
          console.log('[Sonos:Visibility] Paused for 5 min — transitioning to IDLE, stopping polling');
          setNowPlaying(prev => prev ? { ...prev, playback_state: 'PLAYBACK_STATE_IDLE' } : prev);
          pauseTimerRef.current = null;
        }, PAUSE_TIMEOUT_MS);
      }
      return;
    }
    // Not paused — reset
    if (pauseTimerRef.current) { clearTimeout(pauseTimerRef.current); pauseTimerRef.current = null; }
  }, [isPaused]);

  const shouldHide = isInactive || (wantsToHide && graceExpired);
  return { shouldHide };
}
