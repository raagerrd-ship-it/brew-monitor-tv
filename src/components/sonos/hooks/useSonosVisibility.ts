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

/**
 * Manages widget visibility.
 * - Inactive (no connection / no track / TV Audio) → hide immediately.
 * - IDLE → 5s grace then hide.
 * - PAUSED on two consecutive checks → hide immediately.
 */
export function useSonosVisibility(params: UseSonosVisibilityParams) {
  const { isConnected, showWidget, nowPlaying, onAlbumArtChangeRef, bgSentRef, validBgBufferRef } = params;
  const [graceExpired, setGraceExpired] = useState(false);
  const hideGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasPausedRef = useRef(false);
  const [pauseHidden, setPauseHidden] = useState(false);

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

  // PAUSED: if paused on two consecutive nowPlaying updates → hide
  useEffect(() => {
    if (isInactive) {
      wasPausedRef.current = false;
      setPauseHidden(false);
      return;
    }
    if (isPaused) {
      if (wasPausedRef.current) {
        console.log('[Sonos:Visibility] Paused on consecutive updates — hiding widget');
        setPauseHidden(true);
        clearAll();
      } else {
        wasPausedRef.current = true;
      }
    } else {
      wasPausedRef.current = false;
      setPauseHidden(false);
    }
  }, [isPaused, isInactive, nowPlaying?.updated_at]);

  const shouldHide = isInactive || (wantsToHide && graceExpired) || pauseHidden;
  return { shouldHide };
}
