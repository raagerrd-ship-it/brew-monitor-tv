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

  const isInactive = !isConnected || !showWidget || !nowPlaying?.track_name || nowPlaying.track_name === 'TV Audio';
  const wantsToHide = !isInactive && nowPlaying?.playback_state === 'PLAYBACK_STATE_IDLE';

  useEffect(() => {
    if (isInactive) {
      if (hideGraceTimerRef.current) { clearTimeout(hideGraceTimerRef.current); hideGraceTimerRef.current = null; }
      setGraceExpired(true);
      onAlbumArtChangeRef.current?.(null);
      bgSentRef.current = null;
      validBgBufferRef.current = [];
      return;
    }
    if (wantsToHide) {
      if (!hideGraceTimerRef.current) {
        hideGraceTimerRef.current = setTimeout(() => {
          setGraceExpired(true);
          onAlbumArtChangeRef.current?.(null);
          bgSentRef.current = null;
          validBgBufferRef.current = [];
          hideGraceTimerRef.current = null;
        }, 5000);
      }
      return;
    }
    // Active — cancel grace, show widget
    if (hideGraceTimerRef.current) { clearTimeout(hideGraceTimerRef.current); hideGraceTimerRef.current = null; }
    setGraceExpired(false);
  }, [isInactive, wantsToHide]);

  const shouldHide = isInactive || (wantsToHide && graceExpired);
  return { shouldHide };
}
