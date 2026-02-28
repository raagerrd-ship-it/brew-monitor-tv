import { useCallback } from 'react';
import { NowPlaying, triggerServerSync, fetchPlaybackStatus, pushToBgBuffer, updateProgressDOM } from './types';
import { tvDebug } from '@/lib/tv-debug-log';

interface UseSonosTrackChangeParams {
  setNowPlaying: React.Dispatch<React.SetStateAction<NowPlaying | null>>;
  setCurrentArtStatus: (status: 'displayed' | 'detecting' | 'loading') => void;
  localProgressRef: React.MutableRefObject<number | null>;
  trackChangedAtRef: React.MutableRefObject<number>;
  bgSentRef: React.MutableRefObject<string | null>;
  validBgBufferRef: React.MutableRefObject<string[]>;
  onAlbumArtChangeRef: React.MutableRefObject<((url: string | null) => void) | undefined>;
  progressBarRef: React.RefObject<HTMLDivElement | null>;
  debugTimeRef: React.RefObject<HTMLSpanElement | null>;
  addDebugLog?: (event: string) => void;
}

interface TrackChangeData {
  trackName: string;
  artistName?: string | null;
  albumName?: string | null;
  playbackState: string;
  positionMillis: number;
}

/**
 * Consolidated track-change handler used by predictive poll and 5s poll.
 * Immediately updates text/metadata, then triggers server sync + refetch for images.
 */
export function useSonosTrackChange(params: UseSonosTrackChangeParams) {
  const {
    setNowPlaying, setCurrentArtStatus,
    localProgressRef, trackChangedAtRef,
    bgSentRef, validBgBufferRef, onAlbumArtChangeRef,
    progressBarRef, debugTimeRef, addDebugLog,
  } = params;

  let trackChangeCounter = 0;

  const handleTrackChange = useCallback((data: TrackChangeData) => {
    const tcId = `tc-${++trackChangeCounter}`;
    const artId = `art-${trackChangeCounter}`;
    const t0 = performance.now();
    tvDebug('sonos', `🎵 Låtbyte: "${data.trackName}"`, tcId);
    console.log('[Sonos:TC] 🎵 Track change detected:', {
      newTrack: data.trackName,
      artist: data.artistName,
      positionMs: data.positionMillis,
      state: data.playbackState,
    });
    trackChangedAtRef.current = Date.now();
    localProgressRef.current = data.positionMillis;

    setNowPlaying(prev => {
      if (!prev) return prev;
      console.log(`[Sonos:TC] Previous track: "${prev.track_name}" → "${data.trackName}"`);

      updateProgressDOM(progressBarRef, debugTimeRef, data.positionMillis, prev.duration_ms);

      // Trigger server sync — images arrive via realtime subscription
      const hasPreloadedImages = !!(prev.next_widget_art_url || prev.next_bg_image_url);
      tvDebug('sonos', hasPreloadedImages ? `✅ Förladdade bilder finns` : `🔄 Hämtar låtbild...`, artId);
      console.log(`[Sonos:TC] ${hasPreloadedImages ? '✅ Using preloaded images' : '🔄 Triggering server sync for new art...'}`);
      (async () => {
        const syncT0 = performance.now();
        try {
          await triggerServerSync();
          const ms = Math.round(performance.now() - syncT0);
          tvDebug('sonos', `✅ Server sync klar`, artId);
          console.log(`[Sonos:TC] ✅ Server sync completed in ${ms}ms`);

          // If no preloaded images were available, fetch them now directly
          if (!hasPreloadedImages) {
            const fetchT0 = performance.now();
            const directId = `art-direct-${trackChangeCounter}`;
            tvDebug('sonos', `🖼️ Hämtar bilder direkt...`, directId);
            const result = await fetchPlaybackStatus();
            const fetchMs = Math.round(performance.now() - fetchT0);
            if (result) {
              tvDebug('sonos', `✅ Bilder hämtade`, directId);
              console.log(`[Sonos:TC] ✅ Direct art fetch in ${fetchMs}ms`);
              setNowPlaying(cur => cur ? {
                ...cur,
                ...(result.widgetArtUrl ? { widget_art_url: result.widgetArtUrl } : {}),
                ...(result.bgImageUrl ? { bg_image_url: result.bgImageUrl } : {}),
                ...(result.albumArtUrl ? { album_art_url: result.albumArtUrl } : {}),
              } : cur);
              // Trigger background preload immediately
              if (result.bgImageUrl) {
                pushToBgBuffer(validBgBufferRef.current, result.bgImageUrl);
                onAlbumArtChangeRef.current?.(result.bgImageUrl);
                bgSentRef.current = result.bgImageUrl;
                tvDebug('sonos', `🖼️ Bakgrund triggad från direkt-hämtning`);
              }
            }
          }
        } catch (e: any) {
          const ms = Math.round(performance.now() - syncT0);
          tvDebug('sonos', `❌ Server sync fail`, artId);
          console.error(`[Sonos:TC] ❌ Server sync failed after ${ms}ms:`, e?.message || e);
        }
      })();

      const ms = Math.round(performance.now() - t0);
      console.log(`[Sonos:TC] State update applied in ${ms}ms`);
      tvDebug('sonos', `📝 Widget-text bytt: "${data.trackName}"`, tcId);
      // Use preloaded next-track images if available
      const nextWidget = prev.next_widget_art_url;
      const nextBg = prev.next_bg_image_url;
      const nextArt = prev.next_album_art_url;
      if (nextWidget || nextBg) {
        tvDebug('sonos', `🖼️ Använder förladdat: widget=${!!nextWidget}, bg=${!!nextBg}`);
      }
      // Trigger background preload for preloaded next-track images immediately
      if (nextBg) {
        pushToBgBuffer(validBgBufferRef.current, nextBg);
        onAlbumArtChangeRef.current?.(nextBg);
        bgSentRef.current = nextBg;
        tvDebug('sonos', `🖼️ Bakgrund triggad från förladdat`);
      }

      return {
        ...prev,
        track_name: data.trackName,
        artist_name: data.artistName ?? prev.artist_name,
        album_name: data.albumName ?? prev.album_name,
        playback_state: data.playbackState,
        position_ms: data.positionMillis,
        // Apply preloaded next-track images immediately
        ...(nextWidget ? { widget_art_url: nextWidget } : {}),
        ...(nextBg ? { bg_image_url: nextBg } : {}),
        ...(nextArt ? { album_art_url: nextArt } : {}),
        // Clear next-track fields
        next_widget_art_url: null,
        next_bg_image_url: null,
        next_album_art_url: null,
        next_track_name: null,
        next_artist_name: null,
      };
    });
  }, [setNowPlaying, setCurrentArtStatus, localProgressRef, trackChangedAtRef, bgSentRef, validBgBufferRef, onAlbumArtChangeRef, progressBarRef, debugTimeRef, addDebugLog]);

  return { handleTrackChange };
}
