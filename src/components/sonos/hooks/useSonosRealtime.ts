import { useEffect } from 'react';
import { NowPlaying, pushToBgBuffer, updateProgressDOM } from './types';

interface UseSonosRealtimeParams {
  onRealtimeRef?: React.MutableRefObject<((payload: any) => void) | null>;
  isConnected: boolean;
  showWidget: boolean;
  setNowPlaying: React.Dispatch<React.SetStateAction<NowPlaying | null>>;
  localProgressRef: React.MutableRefObject<number | null>;
  trackChangedAtRef: React.MutableRefObject<number>;
  bgSentRef: React.MutableRefObject<string | null>;
  validBgBufferRef: React.MutableRefObject<string[]>;
  onAlbumArtChangeRef: React.MutableRefObject<((url: string | null) => void) | undefined>;
  progressBarRef: React.RefObject<HTMLDivElement | null>;
  debugTimeRef: React.RefObject<HTMLSpanElement | null>;
  addDebugLog?: (event: string) => void;
}

/**
 * Wires up the realtime callback for sonos_now_playing changes.
 * Applies 15-second cooldown after track changes to prevent stale data overwrites.
 * Track-aware: ignores updates for different tracks than what's locally displayed.
 */
export function useSonosRealtime(params: UseSonosRealtimeParams) {
  const {
    onRealtimeRef, isConnected, showWidget, setNowPlaying,
    localProgressRef, trackChangedAtRef, bgSentRef, validBgBufferRef,
    onAlbumArtChangeRef, progressBarRef, debugTimeRef, addDebugLog,
  } = params;

  useEffect(() => {
    if (!onRealtimeRef || !isConnected || !showWidget) return;

    const acceptedRef = { current: false };

    onRealtimeRef.current = (payload: any) => {
      if (!payload.new) return;
      const incoming = payload.new as NowPlaying;
      acceptedRef.current = false;

      setNowPlaying(prev => {
        if (!prev) { acceptedRef.current = true; return incoming; }

        // When currently IDLE and incoming is PLAYING with a track, accept it to wake up the widget
        if (prev.playback_state === 'PLAYBACK_STATE_IDLE' && incoming.playback_state === 'PLAYBACK_STATE_PLAYING' && incoming.track_name) {
          console.log(`[Sonos] Waking from IDLE via realtime: "${incoming.track_name}"`);
          addDebugLog?.(`📻 RT: wake from IDLE → ${incoming.track_name}`);
          acceptedRef.current = true;
          if (incoming.bg_image_url) {
            pushToBgBuffer(validBgBufferRef.current, incoming.bg_image_url);
            onAlbumArtChangeRef.current?.(incoming.bg_image_url);
            bgSentRef.current = incoming.bg_image_url;
          }
          trackChangedAtRef.current = Date.now();
          return incoming;
        }

        // After a local track change, ignore ALL realtime for 15s to let server catch up
        const msSinceTrackChange = Date.now() - trackChangedAtRef.current;
        if (msSinceTrackChange < 15000) {
          // Only accept bg_image_url if it's genuinely new for the current track
          if (incoming.track_name === prev.track_name) {
            const bgChanged = incoming.bg_image_url && incoming.bg_image_url !== prev.bg_image_url;
            const widgetChanged = incoming.widget_art_url && incoming.widget_art_url !== prev.widget_art_url;
            if (bgChanged || widgetChanged) {
              addDebugLog?.(`📻 RT: art update during cooldown (bg=${!!bgChanged}, widget=${!!widgetChanged})`);
              if (bgChanged) {
                pushToBgBuffer(validBgBufferRef.current, incoming.bg_image_url);
                onAlbumArtChangeRef.current?.(incoming.bg_image_url);
              }
              return {
                ...prev,
                ...(bgChanged ? { bg_image_url: incoming.bg_image_url } : {}),
                ...(widgetChanged ? { widget_art_url: incoming.widget_art_url } : {}),
              };
            }
          }
          console.log(`[Sonos] Ignoring realtime during cooldown (${Math.round(msSinceTrackChange / 1000)}s): "${incoming.track_name}"`);
          return prev;
        }

        if (incoming.track_name !== prev.track_name) {
          console.log(`[Sonos] Ignoring stale realtime: DB has "${incoming.track_name}", local has "${prev.track_name}"`);
          addDebugLog?.(`📻 RT: ignored stale (${incoming.track_name})`);
          return prev;
        }

        // Don't let realtime overwrite local IDLE (set by pause timeout) — only PLAYING wake (handled above) can exit IDLE
        if (prev.playback_state === 'PLAYBACK_STATE_IDLE') {
          console.log(`[Sonos] Ignoring realtime ${incoming.playback_state} — already transitioned to IDLE`);
          return prev;
        }

        // Same track — merge in any new art URLs
        acceptedRef.current = true;
        const updatedBg = incoming.bg_image_url || prev.bg_image_url;
        const bgChanged = updatedBg !== prev.bg_image_url;
        if (bgChanged) {
          pushToBgBuffer(validBgBufferRef.current, updatedBg);
          onAlbumArtChangeRef.current?.(updatedBg);
        }
        return {
          ...prev,
          ...incoming,
          album_art_url: incoming.album_art_url || prev.album_art_url,
          bg_image_url: updatedBg,
        };
      });

      // Only update progress if the realtime data was actually accepted
      if (acceptedRef.current && incoming.position_ms != null) {
        localProgressRef.current = incoming.position_ms;
        updateProgressDOM(progressBarRef, debugTimeRef, incoming.position_ms, incoming.duration_ms);
      }
    };

    return () => { if (onRealtimeRef) onRealtimeRef.current = null; };
  }, [onRealtimeRef, isConnected, showWidget]);
}
