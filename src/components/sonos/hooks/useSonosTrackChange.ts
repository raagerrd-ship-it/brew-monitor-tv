import { useCallback } from 'react';
import { NowPlaying, triggerServerSync, fetchNowPlayingImages, pushToBgBuffer, updateProgressDOM } from './types';
import { tvDebug } from '@/lib/tv-debug-log';

interface UseSonosTrackChangeParams {
  setNowPlaying: React.Dispatch<React.SetStateAction<NowPlaying | null>>;
  localProgressRef: React.MutableRefObject<number | null>;
  trackChangedAtRef: React.MutableRefObject<number>;
  bgSentRef: React.MutableRefObject<string | null>;
  validBgBufferRef: React.MutableRefObject<string[]>;
  onAlbumArtChangeRef: React.MutableRefObject<((url: string | null, trackName?: string) => void) | undefined>;
  progressBarRef: React.RefObject<HTMLDivElement | null>;
  debugTimeRef: React.RefObject<HTMLSpanElement | null>;
}

interface TrackChangeData {
  trackName: string;
  artistName?: string | null;
  albumName?: string | null;
  playbackState: string;
  positionMillis: number;
}

/**
 * Track change handler. Two paths:
 * 1. Preloaded images exist → instant swap, zero network
 * 2. No preloaded images → server sync + DB fetch (fallback)
 */
export function useSonosTrackChange(params: UseSonosTrackChangeParams) {
  const {
    setNowPlaying, localProgressRef, trackChangedAtRef,
    bgSentRef, validBgBufferRef, onAlbumArtChangeRef,
    progressBarRef, debugTimeRef,
  } = params;

  const handleTrackChange = useCallback((data: TrackChangeData) => {
    trackChangedAtRef.current = Date.now();
    localProgressRef.current = data.positionMillis;

    setNowPlaying(prev => {
      if (!prev) return prev;

      updateProgressDOM(progressBarRef, debugTimeRef, data.positionMillis, prev.duration_ms);

      const nextBg = prev.next_bg_image_url;
      const nextWidget = prev.next_widget_art_url;
      const nextArt = prev.next_album_art_url;
      // Only use preloaded images if they match the incoming track
      const preloadMatchesTrack = prev.next_track_name === data.trackName;
      const hasPreloaded = preloadMatchesTrack && !!(nextWidget || nextBg);

      if (hasPreloaded) {
        tvDebug('sonos', `🎵 → "${data.trackName}" (förladdat ✅)`);
        if (nextBg) {
          pushToBgBuffer(validBgBufferRef.current, nextBg);
          onAlbumArtChangeRef.current?.(nextBg, data.trackName);
          bgSentRef.current = nextBg;
        }
      } else {
        tvDebug('sonos', `🎵 → "${data.trackName}" (väntar på RT...)`);
        // Wait 2s for RT to deliver images before expensive fallback
        (async () => {
          await new Promise(r => setTimeout(r, 2000));
          // Check if bg was already set by RT during the wait
          if (bgSentRef.current && bgSentRef.current !== prev.bg_image_url) {
            tvDebug('sonos', `✅ RT levererade bilder under väntan`);
            return;
          }
          try {
            await triggerServerSync();
            const result = await fetchNowPlayingImages();
            if (result?.bgImageUrl) {
              pushToBgBuffer(validBgBufferRef.current, result.bgImageUrl);
              onAlbumArtChangeRef.current?.(result.bgImageUrl, data.trackName);
              bgSentRef.current = result.bgImageUrl;
            }
            if (result) {
              setNowPlaying(cur => cur ? {
                ...cur,
                ...(result.widgetArtUrl ? { widget_art_url: result.widgetArtUrl } : {}),
                ...(result.bgImageUrl ? { bg_image_url: result.bgImageUrl } : {}),
                ...(result.albumArtUrl ? { album_art_url: result.albumArtUrl } : {}),
              } : cur);
            }
          } catch { /* ignore */ }
        })();
      }

      return {
        ...prev,
        track_name: data.trackName,
        artist_name: data.artistName ?? prev.artist_name,
        album_name: data.albumName ?? prev.album_name,
        playback_state: data.playbackState,
        position_ms: data.positionMillis,
        ...(nextWidget ? { widget_art_url: nextWidget } : {}),
        ...(nextBg ? { bg_image_url: nextBg } : {}),
        ...(nextArt ? { album_art_url: nextArt } : {}),
        next_widget_art_url: null,
        next_bg_image_url: null,
        next_album_art_url: null,
        next_track_name: null,
        next_artist_name: null,
      };
    });
  }, [setNowPlaying, localProgressRef, trackChangedAtRef, bgSentRef, validBgBufferRef, onAlbumArtChangeRef, progressBarRef, debugTimeRef]);

  return { handleTrackChange };
}
