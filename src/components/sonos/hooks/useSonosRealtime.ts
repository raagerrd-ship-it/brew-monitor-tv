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
  onAlbumArtChangeRef: React.MutableRefObject<((url: string | null, trackName?: string) => void) | undefined>;
  progressBarRef: React.RefObject<HTMLDivElement | null>;
  debugTimeRef: React.RefObject<HTMLSpanElement | null>;
  addDebugLog?: (event: string) => void;
}

/**
 * Realtime handler for sonos_now_playing.
 *
 * Design: RT's only jobs are:
 * 1. Deliver next_* fields (images/metadata for upcoming track swap)
 * 2. Relay state changes (pause/idle/playing)
 * 3. Handle first-time init and wake-from-IDLE
 * 4. Handle track changes NOT caught by predictive swap (e.g. skip)
 *
 * RT does NOT touch current bg/widget after a track has been displayed.
 * Those are set once (by predictive swap or init) and locked.
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

      if (!incoming.track_name) {
        tvDebug('sonos', '⚠️ RT: ignorerade null track_name');
        return;
      }

      tvDebug('sonos', `📡 RT: "${incoming.track_name}" state=${incoming.playback_state}`);

      setNowPlaying(prev => {
        // --- First state: accept everything ---
        if (!prev) {
          tvDebug('sonos', `✅ RT: första state → "${incoming.track_name}"`);
          acceptedRef.current = true;
          if (incoming.bg_image_url) {
            pushToBgBuffer(validBgBufferRef.current, incoming.bg_image_url);
            onAlbumArtChangeRef.current?.(incoming.bg_image_url, incoming.track_name);
            bgSentRef.current = incoming.bg_image_url;
          }
          return incoming;
        }

        // --- Wake from IDLE ---
        if (prev.playback_state === 'PLAYBACK_STATE_IDLE' && incoming.playback_state === 'PLAYBACK_STATE_PLAYING') {
          tvDebug('sonos', `✅ RT: vaknar från IDLE → "${incoming.track_name}"`);
          acceptedRef.current = true;
          if (incoming.bg_image_url) {
            pushToBgBuffer(validBgBufferRef.current, incoming.bg_image_url);
            onAlbumArtChangeRef.current?.(incoming.bg_image_url, incoming.track_name);
            bgSentRef.current = incoming.bg_image_url;
          }
          trackChangedAtRef.current = Date.now();
          return incoming;
        }

        // --- Already IDLE: ignore ---
        if (prev.playback_state === 'PLAYBACK_STATE_IDLE') {
          return prev;
        }

        // --- Cooldown: ignore different-track updates (server hasn't caught up) ---
        const msSinceTC = Date.now() - trackChangedAtRef.current;
        if (msSinceTC < 15000 && incoming.track_name !== prev.track_name) {
          tvDebug('sonos', `⏳ RT: cooldown (${Math.round(msSinceTC / 1000)}s) ignorerad "${incoming.track_name}"`);
          return prev;
        }

        // --- Track change (not caught by predictive swap, e.g. skip) ---
        if (incoming.track_name !== prev.track_name) {
          tvDebug('sonos', `🎵 RT: låtbyte → "${incoming.track_name}"`);
          addDebugLog?.(`📻 RT: låtbyte → ${incoming.track_name}`);
          acceptedRef.current = true;
          trackChangedAtRef.current = Date.now();
          if (incoming.bg_image_url) {
            pushToBgBuffer(validBgBufferRef.current, incoming.bg_image_url);
            onAlbumArtChangeRef.current?.(incoming.bg_image_url, incoming.track_name);
            bgSentRef.current = incoming.bg_image_url;
          }
          return incoming;
        }

        // --- Same track: only accept next_* fields and state changes ---
        acceptedRef.current = true;
        const nextChanged = incoming.next_track_name && incoming.next_track_name !== prev.next_track_name;
        const nextBgChanged = incoming.next_bg_image_url && incoming.next_bg_image_url !== prev.next_bg_image_url;
        const nextWidgetChanged = incoming.next_widget_art_url && incoming.next_widget_art_url !== prev.next_widget_art_url;
        const stateChanged = incoming.playback_state !== prev.playback_state;

        // Preload next-track images
        if (nextBgChanged && incoming.next_bg_image_url) {
          tvDebug('sonos', `🖼️ RT: förladdar next_bg`);
          const img = new Image(); img.src = incoming.next_bg_image_url;
        }
        if (nextWidgetChanged && incoming.next_widget_art_url) {
          tvDebug('sonos', `🖼️ RT: förladdar next_widget`);
          const img = new Image(); img.src = incoming.next_widget_art_url;
        }

        // Fill in bg/widget ONLY if we have none (init without images)
        const needsBg = !prev.bg_image_url && incoming.bg_image_url;
        const needsWidget = !prev.widget_art_url && incoming.widget_art_url;
        if (needsBg) {
          pushToBgBuffer(validBgBufferRef.current, incoming.bg_image_url);
          onAlbumArtChangeRef.current?.(incoming.bg_image_url, incoming.track_name);
          bgSentRef.current = incoming.bg_image_url;
          tvDebug('sonos', `🖼️ RT: bg fylld (saknades)`);
        }

        if (!nextChanged && !nextBgChanged && !nextWidgetChanged && !stateChanged && !needsBg && !needsWidget) {
          return prev; // No meaningful changes
        }

        if (nextChanged) tvDebug('sonos', `📋 RT: next → "${incoming.next_track_name}"`);

        return {
          ...prev,
          playback_state: incoming.playback_state,
          ...(needsBg ? { bg_image_url: incoming.bg_image_url } : {}),
          ...(needsWidget ? { widget_art_url: incoming.widget_art_url } : {}),
          ...(nextChanged ? { next_track_name: incoming.next_track_name, next_artist_name: incoming.next_artist_name } : {}),
          ...(nextBgChanged ? { next_bg_image_url: incoming.next_bg_image_url } : {}),
          ...(nextWidgetChanged ? { next_widget_art_url: incoming.next_widget_art_url } : {}),
          ...(incoming.next_album_art_url ? { next_album_art_url: incoming.next_album_art_url } : {}),
        };
      });

      // Only update progress if accepted
      if (acceptedRef.current && incoming.position_ms != null) {
        localProgressRef.current = incoming.position_ms;
        updateProgressDOM(progressBarRef, debugTimeRef, incoming.position_ms, incoming.duration_ms);
      }
    };

    return () => { if (onRealtimeRef) onRealtimeRef.current = null; };
  }, [onRealtimeRef, isConnected, showWidget]);
}
