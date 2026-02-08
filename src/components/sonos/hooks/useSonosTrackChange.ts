import { useCallback } from 'react';
import { NowPlaying, triggerServerSync, updateProgressDOM } from './types';

interface UseSonosTrackChangeParams {
  setNowPlaying: React.Dispatch<React.SetStateAction<NowPlaying | null>>;
  setCurrentArtStatus: (status: 'displayed' | 'detecting' | 'loading') => void;
  localProgressRef: React.MutableRefObject<number | null>;
  trackChangedAtRef: React.MutableRefObject<number>;
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
 */
export function useSonosTrackChange(params: UseSonosTrackChangeParams) {
  const {
    setNowPlaying, setCurrentArtStatus,
    localProgressRef, trackChangedAtRef,
    progressBarRef, debugTimeRef,
  } = params;

  const handleTrackChange = useCallback((
    data: TrackChangeData,
    earlySwapped: boolean,
  ) => {
    trackChangedAtRef.current = Date.now();
    localProgressRef.current = data.positionMillis;

    setNowPlaying(prev => {
      if (!prev) return prev;

      // Update DOM progress directly — no re-render
      updateProgressDOM(progressBarRef, debugTimeRef, data.positionMillis, prev.duration_ms);

      if (earlySwapped) {
        // Images already swapped by early swap — only update text metadata
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
      triggerServerSync();
      return {
        ...prev,
        track_name: data.trackName,
        artist_name: data.artistName ?? prev.artist_name,
        album_name: data.albumName ?? prev.album_name,
        playback_state: data.playbackState,
        position_ms: data.positionMillis,
        next_album_art_url: null,
        next_bg_image_url: null,
      };
    });
  }, [setNowPlaying, setCurrentArtStatus, localProgressRef, trackChangedAtRef, progressBarRef, debugTimeRef]);

  return { handleTrackChange };
}
