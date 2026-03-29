import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { NowPlaying, pushToBgBuffer, extractFileName, updateProgressDOM } from './types';
import { tvDebug } from '@/lib/tv-debug-log';

interface UseSonosRealtimeParams {
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
}

/**
 * Realtime handler. Only jobs:
 * 1. First init / wake from IDLE → accept all
 * 2. Track change (skip etc) → accept all
 * 3. Same track → only next_* fields + state + fill missing art
 */
export function useSonosRealtime(params: UseSonosRealtimeParams) {
  const {
    isConnected, showWidget, setNowPlaying,
    localProgressRef, trackChangedAtRef, bgSentRef, validBgBufferRef,
    onAlbumArtChangeRef, progressBarRef, debugTimeRef,
  } = params;

  // Store the handler in a ref so the realtime subscription can call the latest version
  const handlerRef = useRef<((payload: any) => void) | null>(null);

  useEffect(() => {
    if (!isConnected || !showWidget) return;

    handlerRef.current = (payload: any) => {
      if (!payload.new) return;
      const incoming = payload.new as NowPlaying;
      if (!incoming.track_name) return;

      let accepted = false;

      setNowPlaying(prev => {
        // Monotonic seq check: reject stale data
        if (prev && typeof incoming.track_seq === 'number' && typeof prev.track_seq === 'number'
            && incoming.track_seq < prev.track_seq) {
          tvDebug('sonos', `📡 RT rejected: seq ${incoming.track_seq} < ${prev.track_seq}`);
          return prev;
        }

        // First state
        if (!prev) {
          accepted = true;
          if (incoming.bg_image_url) {
            pushToBgBuffer(validBgBufferRef.current, incoming.bg_image_url);
            onAlbumArtChangeRef.current?.(incoming.bg_image_url, incoming.track_name);
            bgSentRef.current = incoming.bg_image_url;
          }
          tvDebug('sonos', `📡 RT init: "${incoming.track_name}" (seq ${incoming.track_seq ?? '?'})`);
          return incoming;
        }

        // Wake from IDLE
        if (prev.playback_state === 'PLAYBACK_STATE_IDLE' && incoming.playback_state === 'PLAYBACK_STATE_PLAYING') {
          accepted = true;
          trackChangedAtRef.current = Date.now();
          if (incoming.bg_image_url) {
            pushToBgBuffer(validBgBufferRef.current, incoming.bg_image_url);
            onAlbumArtChangeRef.current?.(incoming.bg_image_url, incoming.track_name);
            bgSentRef.current = incoming.bg_image_url;
          }
          tvDebug('sonos', `📡 RT wake: "${incoming.track_name}"`);
          return incoming;
        }

        // Already IDLE
        if (prev.playback_state === 'PLAYBACK_STATE_IDLE') return prev;

        // Cooldown: ignore different-track (server hasn't caught up)
        const msSinceTC = Date.now() - trackChangedAtRef.current;
        if (msSinceTC < 15000 && incoming.track_name !== prev.track_name) return prev;

        // Track change via RT (skip etc)
        if (incoming.track_name !== prev.track_name) {
          accepted = true;
          trackChangedAtRef.current = Date.now();
          // Only push bg if it's actually NEW (not stale from Phase 1 where server kept old bg)
          const bgIsNew = incoming.bg_image_url && incoming.bg_image_url !== prev.bg_image_url;
          if (bgIsNew) {
            pushToBgBuffer(validBgBufferRef.current, incoming.bg_image_url);
            onAlbumArtChangeRef.current?.(incoming.bg_image_url, incoming.track_name);
            bgSentRef.current = incoming.bg_image_url;
          }
          tvDebug('sonos', `📡 RT låtbyte: "${incoming.track_name}" (bg: ${bgIsNew ? 'ny' : 'väntar'})`);
          return {
            ...incoming,
            // Keep current bg/widget if server hasn't updated them yet (Phase 1)
            bg_image_url: bgIsNew ? incoming.bg_image_url : prev.bg_image_url,
            widget_art_url: incoming.widget_art_url && incoming.widget_art_url !== prev.widget_art_url
              ? incoming.widget_art_url : prev.widget_art_url,
          };
        }

        // Same track → only next_* + state + fill missing/updated art
        accepted = true;
        const stripQs = (u: string | null) => u?.split('?')[0] ?? '';
        const nextBgNew = incoming.next_bg_image_url && stripQs(incoming.next_bg_image_url) !== stripQs(prev.next_bg_image_url);
        const nextWidgetNew = incoming.next_widget_art_url && stripQs(incoming.next_widget_art_url) !== stripQs(prev.next_widget_art_url);
        // Accept bg if missing OR if server sent a different one (Phase 2 after track change)
        const bgChanged = incoming.bg_image_url && stripQs(incoming.bg_image_url) !== stripQs(prev.bg_image_url);
        const widgetChanged = incoming.widget_art_url && stripQs(incoming.widget_art_url) !== stripQs(prev.widget_art_url);

        // Preload next images
        if (nextBgNew) { const img = new Image(); img.src = incoming.next_bg_image_url!; }
        if (nextWidgetNew) { const img = new Image(); img.src = incoming.next_widget_art_url!; }

        if (bgChanged) {
          pushToBgBuffer(validBgBufferRef.current, incoming.bg_image_url);
          onAlbumArtChangeRef.current?.(incoming.bg_image_url, incoming.track_name);
          bgSentRef.current = incoming.bg_image_url;
        }

        if (nextBgNew) {
          tvDebug('sonos', `📡 RT next: ${extractFileName(incoming.next_bg_image_url)}`);
        }

        const hasChanges = nextBgNew || nextWidgetNew || bgChanged || widgetChanged
          || incoming.playback_state !== prev.playback_state
          || (incoming.next_track_name && incoming.next_track_name !== prev.next_track_name);

        if (!hasChanges) return prev;

        return {
          ...prev,
          playback_state: incoming.playback_state,
          ...(bgChanged ? { bg_image_url: incoming.bg_image_url } : {}),
          ...(widgetChanged ? { widget_art_url: incoming.widget_art_url } : {}),
          ...(incoming.next_track_name && incoming.next_track_name !== prev.next_track_name
            ? { next_track_name: incoming.next_track_name, next_artist_name: incoming.next_artist_name } : {}),
          ...(nextBgNew ? { next_bg_image_url: incoming.next_bg_image_url } : {}),
          ...(nextWidgetNew ? { next_widget_art_url: incoming.next_widget_art_url } : {}),
          ...(incoming.next_album_art_url ? { next_album_art_url: incoming.next_album_art_url } : {}),
        };
      });

      if (accepted && incoming.position_ms != null) {
        localProgressRef.current = incoming.position_ms;
        updateProgressDOM(progressBarRef, debugTimeRef, incoming.position_ms, incoming.duration_ms);
      }
    };

    // Subscribe to realtime changes on sonos_now_playing
    const channel = supabase
      .channel('sonos-widget-realtime')
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'sonos_now_playing' }, (payload: any) => {
        handlerRef.current?.(payload);
      })
      .subscribe();

    // DB polling fallback (30s) — Realtime is unreliable on Chromecast/TV
    const pollDb = async () => {
      try {
        const { data } = await supabase
          .from('sonos_now_playing')
          .select('track_name, artist_name, album_name, album_art_url, bg_image_url, widget_art_url, duration_ms, position_ms, playback_state, updated_at, next_track_name, next_artist_name, next_album_art_url, next_bg_image_url, next_widget_art_url, track_seq')
          .limit(1)
          .maybeSingle();
        if (data) {
          handlerRef.current?.({ new: data });
        }
      } catch { /* ignore */ }
    };
    const pollInterval = setInterval(pollDb, 30_000);

    return () => {
      handlerRef.current = null;
      supabase.removeChannel(channel);
      clearInterval(pollInterval);
    };
  }, [isConnected, showWidget]);
}
