import { useCallback } from 'react';
import { NowPlaying, triggerServerSync, fetchPlaybackStatus, pushToBgBuffer, updateProgressDOM } from './types';

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
}

interface TrackChangeData {
  trackName: string;
  artistName?: string | null;
  albumName?: string | null;
  playbackState: string;
  positionMillis: number;
}

/**
 * Consolidated track-change handler used by predictive poll, 5s poll, and init.
 * Handles both early-swapped (sequential) and non-swapped (random skip) scenarios.
 * For non-early-swap: triggers server sync then immediately refetches bg URL.
 */
export function useSonosTrackChange(params: UseSonosTrackChangeParams) {
  const {
    setNowPlaying, setCurrentArtStatus,
    localProgressRef, trackChangedAtRef,
    bgSentRef, validBgBufferRef, onAlbumArtChangeRef,
    progressBarRef, debugTimeRef,
  } = params;

  const handleTrackChange = useCallback((
    data: TrackChangeData,
    earlySwapped: boolean,
  ) => {
    console.log('[Sonos:BG] handleTrackChange', {
      newTrack: data.trackName,
      earlySwapped,
      positionMs: data.positionMillis,
    });
    trackChangedAtRef.current = Date.now();
    localProgressRef.current = data.positionMillis;

    setNowPlaying(prev => {
      if (!prev) return prev;

      // Update DOM progress directly — no re-render
      updateProgressDOM(progressBarRef, debugTimeRef, data.positionMillis, prev.duration_ms);

      if (earlySwapped) {
        // Images already swapped by early swap — only update text metadata
        console.log('[Sonos:BG] artStatus: displayed (early swapped)');
        setCurrentArtStatus('displayed');
        return {
          ...prev,
          track_name: data.trackName,
          artist_name: data.artistName ?? prev.artist_name,
          album_name: data.albumName ?? prev.album_name,
          playback_state: data.playbackState,
          position_ms: data.positionMillis,
        };
      }

      // Not early-swapped — likely a random skip or detected via polling
      // Keep current art, trigger server sync for correct art
      console.log('[Sonos:BG] Track change (NOT early swapped) — triggering server sync + refetch');
      // Fire-and-forget async: sync then immediately refetch bg
      (async () => {
        await triggerServerSync();
        const fresh = await fetchPlaybackStatus();
        if (fresh?.bgImageUrl) {
          console.log('[Sonos:BG] Post-sync refetch got bg:', fresh.bgImageUrl.slice(-60));
          pushToBgBuffer(validBgBufferRef.current, fresh.bgImageUrl);
          onAlbumArtChangeRef.current?.(fresh.bgImageUrl);
          bgSentRef.current = fresh.bgImageUrl;
          setNowPlaying(cur => cur ? {
            ...cur,
            bg_image_url: fresh.bgImageUrl,
            widget_art_url: fresh.widgetArtUrl || cur.widget_art_url,
            album_art_url: fresh.albumArtUrl || cur.album_art_url,
          } : cur);
        }
      })();

      return {
        ...prev,
        track_name: data.trackName,
        artist_name: data.artistName ?? prev.artist_name,
        album_name: data.albumName ?? prev.album_name,
        playback_state: data.playbackState,
        position_ms: data.positionMillis,
        next_album_art_url: null,
        next_bg_image_url: null,
        next_widget_art_url: null,
      };
    });
  }, [setNowPlaying, setCurrentArtStatus, localProgressRef, trackChangedAtRef, bgSentRef, validBgBufferRef, onAlbumArtChangeRef, progressBarRef, debugTimeRef]);

  return { handleTrackChange };
}
