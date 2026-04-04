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
 * - PAUSED → 30s without new update then hide.
 */
export function useSonosVisibility(params: UseSonosVisibilityParams) {
  const { isConnected, showWidget, nowPlaying, onAlbumArtChangeRef, bgSentRef, validBgBufferRef } = params;
  const [graceExpired, setGraceExpired] = useState(false);
  const hideGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pauseHidden, setPauseHidden] = useState(false);
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

  // PAUSED: hide after 30s without a new update
  useEffect(() => {
    if (isInactive) {
      if (pauseTimerRef.current) { clearTimeout(pauseTimerRef.current); pauseTimerRef.current = null; }
      setPauseHidden(false);
      return;
    }
    if (isPaused) {
      // (Re)start 30s timer on every update while paused
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = setTimeout(() => {
        console.log('[Sonos:Visibility] Paused for 30s without update — hiding widget');
        setPauseHidden(true);
        clearAll();
        pauseTimerRef.current = null;
      }, 30_000);
    } else {
      if (pauseTimerRef.current) { clearTimeout(pauseTimerRef.current); pauseTimerRef.current = null; }
      setPauseHidden(false);
    }
  }, [isPaused, isInactive, nowPlaying?.playback_state, nowPlaying?.track_name, nowPlaying?.position_ms]);

  const shouldHide = isInactive || (wantsToHide && graceExpired) || pauseHidden;
  return { shouldHide };
}
