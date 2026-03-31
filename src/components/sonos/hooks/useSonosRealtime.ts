import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { NowPlaying, isSeqStale, pushToBgBuffer, extractFileName, updateProgressDOM } from './types';
import { tvDebug } from '@/lib/tv-debug-log';

interface UseSonosRealtimeParams {
  isConnected: boolean;
  showWidget: boolean;
  setNowPlaying: React.Dispatch<React.SetStateAction<NowPlaying | null>>;
  localProgressRef: React.MutableRefObject<number | null>;
  bgSentRef: React.MutableRefObject<string | null>;
  validBgBufferRef: React.MutableRefObject<string[]>;
  onAlbumArtChangeRef: React.MutableRefObject<((url: string | null, trackName?: string) => void) | undefined>;
  progressBarRef: React.RefObject<HTMLDivElement | null>;
  debugTimeRef: React.RefObject<HTMLSpanElement | null>;
  acceptedSeqRef: React.MutableRefObject<number>;
  swappedFromRef: React.MutableRefObject<{ trackName: string; ts: number } | null>;
}

/**
 * Realtime handler with monotonic seq-gate.
 * Incoming data with track_seq < acceptedSeqRef is always rejected.
 */
export function useSonosRealtime(params: UseSonosRealtimeParams) {
  const {
    isConnected, showWidget, setNowPlaying,
    localProgressRef, bgSentRef, validBgBufferRef,
    onAlbumArtChangeRef, progressBarRef, debugTimeRef,
    acceptedSeqRef, swappedFromRef,
  } = params;

  const handlerRef = useRef<((payload: any) => void) | null>(null);

  useEffect(() => {
    if (!isConnected || !showWidget) return;

    handlerRef.current = (payload: any) => {
      if (!payload.new) return;
      const incoming = payload.new as NowPlaying;
      if (!incoming.track_name) return;

      // Monotonic seq-gate: reject stale data
      if (isSeqStale(acceptedSeqRef.current, incoming.track_seq)) {
        tvDebug('sonos', `📡 RT rejected: seq ${incoming.track_seq} < accepted ${acceptedSeqRef.current}`);
        return;
      }

      let accepted = false;
      let isTrackChange = false;

      setNowPlaying(prev => {
        // First state
        if (!prev) {
          accepted = true;
          isTrackChange = true;
          if (typeof incoming.track_seq === 'number') acceptedSeqRef.current = incoming.track_seq;
          if (incoming.bg_image_url) {
            pushToBgBuffer(validBgBufferRef.current, incoming.bg_image_url);
            onAlbumArtChangeRef.current?.(incoming.bg_image_url, incoming.track_name);
            bgSentRef.current = incoming.bg_image_url;
          }
          tvDebug('sonos', `📡 RT init: "${incoming.track_name}" (seq ${incoming.track_seq ?? '?'}, pos ${Math.round((incoming.position_ms ?? 0) / 1000)}s)`);
          return incoming;
        }

        // Wake from IDLE
        if (prev.playback_state === 'PLAYBACK_STATE_IDLE' && incoming.playback_state === 'PLAYBACK_STATE_PLAYING') {
          accepted = true;
          isTrackChange = true;
          if (typeof incoming.track_seq === 'number') acceptedSeqRef.current = incoming.track_seq;
          if (incoming.bg_image_url) {
            pushToBgBuffer(validBgBufferRef.current, incoming.bg_image_url);
            onAlbumArtChangeRef.current?.(incoming.bg_image_url, incoming.track_name);
            bgSentRef.current = incoming.bg_image_url;
          }
          tvDebug('sonos', `📡 RT wake: "${incoming.track_name}" (pos ${Math.round((incoming.position_ms ?? 0) / 1000)}s)`);
          return incoming;
        }

        // Already IDLE
        if (prev.playback_state === 'PLAYBACK_STATE_IDLE') return prev;

        // Track change via RT — only accept if seq is strictly higher
        if (incoming.track_name !== prev.track_name) {
          const incomingSeq = incoming.track_seq ?? 0;
          const currentSeq = acceptedSeqRef.current;
          
          if (incomingSeq < currentSeq) {
            tvDebug('sonos', `📡 RT track change blocked: seq ${incomingSeq} < accepted ${currentSeq}`);
            return prev;
          }

          // Revert guard: reject track changes back to the track we just swapped away from
          const REVERT_GUARD_MS = 30_000;
          const swapped = swappedFromRef.current;
          if (swapped && incoming.track_name === swapped.trackName && (Date.now() - swapped.ts) < REVERT_GUARD_MS) {
            tvDebug('sonos', `📡 RT revert blocked: "${incoming.track_name}" (swapped from ${((Date.now() - swapped.ts) / 1000).toFixed(1)}s ago)`);
            return prev;
          }

          // Clear revert guard since we're accepting a new track
          swappedFromRef.current = null;
          accepted = true;
          isTrackChange = true;
          acceptedSeqRef.current = incomingSeq;

          // Use preloaded next-track images if they match the incoming track
          const preloadMatch = prev.next_track_name === incoming.track_name;
          const preloadedBg = preloadMatch ? prev.next_bg_image_url : null;
          const preloadedArt = preloadMatch ? prev.next_album_art_url : null;

          const effectiveBg = incoming.bg_image_url || preloadedBg;
          const effectiveArt = incoming.album_art_url || preloadedArt;

          if (effectiveBg && effectiveBg !== prev.bg_image_url) {
            pushToBgBuffer(validBgBufferRef.current, effectiveBg);
            onAlbumArtChangeRef.current?.(effectiveBg, incoming.track_name);
            bgSentRef.current = effectiveBg;
          }
          tvDebug('sonos', `📡 RT låtbyte: "${incoming.track_name}" seq=${incomingSeq} pos=${Math.round((incoming.position_ms ?? 0) / 1000)}s (bg: ${effectiveBg ? (preloadedBg ? 'förladdad ✅' : 'ny') : 'väntar'})`);
          return {
            ...incoming,
            bg_image_url: effectiveBg || null,
            album_art_url: effectiveArt || prev.album_art_url,
            next_bg_image_url: null,
            next_album_art_url: null,
            next_track_name: null,
            next_artist_name: null,
          };
        }

        // Same track → only next_* + state + fill missing/updated art
        accepted = true;
        // Update accepted seq if higher (same track, server confirmed)
        if (typeof incoming.track_seq === 'number' && incoming.track_seq > acceptedSeqRef.current) {
          acceptedSeqRef.current = incoming.track_seq;
        }

        // Sync local progress from periodic push to prevent ticker drift,
        // Bridge position is stale — position correction handled by 10s poll against sonos-playback-status

        const stripQs = (u: string | null) => u?.split('?')[0] ?? '';
        const nextBgNew = incoming.next_bg_image_url && stripQs(incoming.next_bg_image_url) !== stripQs(prev.next_bg_image_url);
        const bgChanged = incoming.bg_image_url && stripQs(incoming.bg_image_url) !== stripQs(prev.bg_image_url);
        const hasVisibleBg = !!(prev.bg_image_url || bgSentRef.current);
        // Same track should only fill a missing bg, not swap in a second variant a few seconds later.
        const bgAlreadySent = incoming.bg_image_url && bgSentRef.current && stripQs(incoming.bg_image_url) === stripQs(bgSentRef.current);
        const bgActuallyChanged = bgChanged && !bgAlreadySent && !hasVisibleBg;

        if (nextBgNew) { const img = new Image(); img.src = incoming.next_bg_image_url!; }

        if (bgActuallyChanged) {
          pushToBgBuffer(validBgBufferRef.current, incoming.bg_image_url);
          onAlbumArtChangeRef.current?.(incoming.bg_image_url, incoming.track_name);
          bgSentRef.current = incoming.bg_image_url;
        }

        if (nextBgNew) {
          tvDebug('sonos', `📡 RT next: ${extractFileName(incoming.next_bg_image_url)}`);
        }

        const hasChanges = nextBgNew || bgActuallyChanged
          || incoming.playback_state !== prev.playback_state
          || (incoming.next_track_name && incoming.next_track_name !== prev.next_track_name);

        if (!hasChanges) {
          // Keep PAUSED heartbeats observable to visibility logic.
          if (incoming.playback_state === 'PLAYBACK_STATE_PAUSED') {
            return { ...prev };
          }

          return prev;
        }

        return {
          ...prev,
          playback_state: incoming.playback_state,
          ...(bgActuallyChanged ? { bg_image_url: incoming.bg_image_url } : {}),
          ...(incoming.next_track_name && incoming.next_track_name !== prev.next_track_name
            ? { next_track_name: incoming.next_track_name, next_artist_name: incoming.next_artist_name } : {}),
          ...(nextBgNew ? { next_bg_image_url: incoming.next_bg_image_url } : {}),
          ...(incoming.next_album_art_url ? { next_album_art_url: incoming.next_album_art_url } : {}),
        };
      });

      if (isTrackChange && incoming.position_ms != null) {
        localProgressRef.current = incoming.position_ms;
        updateProgressDOM(progressBarRef, debugTimeRef, incoming.position_ms, incoming.duration_ms);
      }
    };

    const channel = supabase
      .channel('sonos-widget-realtime')
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'sonos_now_playing' }, (payload: any) => {
        handlerRef.current?.(payload);
      })
      .subscribe();

    const pollDb = async () => {
      try {
        const { data } = await supabase
          .from('sonos_now_playing')
          .select('track_name, artist_name, album_name, album_art_url, bg_image_url, duration_ms, position_ms, playback_state, updated_at, next_track_name, next_artist_name, next_album_art_url, next_bg_image_url, track_seq, media_type')
          .order('updated_at', { ascending: false })
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
