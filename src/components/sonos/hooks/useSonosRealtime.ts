import { useEffect } from 'react';
import { NowPlaying, pushToBgBuffer, updateProgressDOM } from './types';
import { tvDebug } from '@/lib/tv-debug-log';

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

      // Guard: ignore realtime with null track_name (API hiccup)
      if (!incoming.track_name) {
        console.log('[Sonos:RT] ⚠️ Ignored realtime with null track_name');
        return;
      }
      
      console.log('[Sonos:RT] 📡 Realtime update received:', {
        track: incoming.track_name,
        state: incoming.playback_state,
        hasBg: !!incoming.bg_image_url,
        hasWidget: !!incoming.widget_art_url,
        bgUrl: incoming.bg_image_url?.slice(-60),
      });
      tvDebug('sonos', `📡 Realtime: "${incoming.track_name}" (bg=${!!incoming.bg_image_url}, widget=${!!incoming.widget_art_url})`);

      setNowPlaying(prev => {
        if (!prev) {
          console.log('[Sonos:RT] ✅ No previous state — accepting incoming');
          acceptedRef.current = true;
          return incoming;
        }

        // When currently IDLE and incoming is PLAYING with a track, accept it to wake up the widget
        if (prev.playback_state === 'PLAYBACK_STATE_IDLE' && incoming.playback_state === 'PLAYBACK_STATE_PLAYING' && incoming.track_name) {
          console.log(`[Sonos:RT] ✅ Waking from IDLE: "${incoming.track_name}"`);
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
          // Only accept art/next-track updates during cooldown
          if (incoming.track_name === prev.track_name) {
            const bgChanged = incoming.bg_image_url && incoming.bg_image_url !== prev.bg_image_url;
            const widgetChanged = incoming.widget_art_url && incoming.widget_art_url !== prev.widget_art_url;
            const nextTrackChanged = incoming.next_track_name && incoming.next_track_name !== prev.next_track_name;
            const nextBgChanged = incoming.next_bg_image_url && incoming.next_bg_image_url !== prev.next_bg_image_url;
            const nextWidgetChanged = incoming.next_widget_art_url && incoming.next_widget_art_url !== prev.next_widget_art_url;
            const hasChanges = bgChanged || widgetChanged || nextTrackChanged || nextBgChanged || nextWidgetChanged;
            if (hasChanges) {
              console.log(`[Sonos:RT] 🖼️ Art/next update during cooldown (${Math.round(msSinceTrackChange / 1000)}s): bg=${!!bgChanged} widget=${!!widgetChanged} next=${!!nextTrackChanged}`);
              if (bgChanged) {
                pushToBgBuffer(validBgBufferRef.current, incoming.bg_image_url);
                onAlbumArtChangeRef.current?.(incoming.bg_image_url);
              }
              // Preload next-track images into browser cache immediately
              if (nextBgChanged && incoming.next_bg_image_url) {
                tvDebug('sonos', `🖼️ RT: förladdar next_bg_image`);
                const img = new Image(); img.src = incoming.next_bg_image_url;
              }
              if (nextWidgetChanged && incoming.next_widget_art_url) {
                tvDebug('sonos', `🖼️ RT: förladdar next_widget_art`);
                const img = new Image(); img.src = incoming.next_widget_art_url;
              }
              return {
                ...prev,
                ...(bgChanged ? { bg_image_url: incoming.bg_image_url } : {}),
                ...(widgetChanged ? { widget_art_url: incoming.widget_art_url } : {}),
                ...(nextTrackChanged ? { next_track_name: incoming.next_track_name, next_artist_name: incoming.next_artist_name } : {}),
                ...(nextBgChanged ? { next_bg_image_url: incoming.next_bg_image_url } : {}),
                ...(nextWidgetChanged ? { next_widget_art_url: incoming.next_widget_art_url } : {}),
                ...(incoming.next_album_art_url ? { next_album_art_url: incoming.next_album_art_url } : {}),
              };
            }
          }
          console.log(`[Sonos:RT] ⏳ Ignored during cooldown (${Math.round(msSinceTrackChange / 1000)}s): "${incoming.track_name}" (local: "${prev.track_name}")`);
          return prev;
        }

        if (incoming.track_name !== prev.track_name) {
          console.log(`[Sonos:RT] ⚠️ Stale track ignored: DB="${incoming.track_name}", local="${prev.track_name}"`);
          addDebugLog?.(`📻 RT: ignored stale (${incoming.track_name})`);
          return prev;
        }

        // Don't let realtime overwrite local IDLE
        if (prev.playback_state === 'PLAYBACK_STATE_IDLE') {
          console.log(`[Sonos:RT] ⚠️ Ignored ${incoming.playback_state} — already IDLE`);
          return prev;
        }

        // Same track — merge in any new art URLs
        acceptedRef.current = true;
        const updatedBg = incoming.bg_image_url || prev.bg_image_url;
        const bgChanged = updatedBg !== prev.bg_image_url;
        if (bgChanged) {
          console.log(`[Sonos:RT] 🖼️ New BG for same track: ${updatedBg?.slice(-60)}`);
          pushToBgBuffer(validBgBufferRef.current, updatedBg);
          onAlbumArtChangeRef.current?.(updatedBg);
        }
        const widgetChanged = incoming.widget_art_url && incoming.widget_art_url !== prev.widget_art_url;
        if (widgetChanged) {
          console.log(`[Sonos:RT] 🖼️ New widget art: ${incoming.widget_art_url?.slice(-60)}`);
        }
        console.log(`[Sonos:RT] ✅ Merged update for "${incoming.track_name}" (bg=${bgChanged}, widget=${!!widgetChanged}, state=${incoming.playback_state})`);
        // Preload next-track images if they arrived with this update
        if (incoming.next_bg_image_url && incoming.next_bg_image_url !== prev.next_bg_image_url) {
          tvDebug('sonos', `🖼️ RT: förladdar next_bg (merge)`);
          const img = new Image(); img.src = incoming.next_bg_image_url;
        }
        if (incoming.next_widget_art_url && incoming.next_widget_art_url !== prev.next_widget_art_url) {
          const img = new Image(); img.src = incoming.next_widget_art_url;
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
