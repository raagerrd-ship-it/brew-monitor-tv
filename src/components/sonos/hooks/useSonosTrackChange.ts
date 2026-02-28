import { useCallback } from 'react';
import { NowPlaying, triggerServerSync, pushToBgBuffer, updateProgressDOM } from './types';

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

  const handleTrackChange = useCallback((data: TrackChangeData) => {
    console.log('[Sonos:BG] handleTrackChange', {
      newTrack: data.trackName,
      positionMs: data.positionMillis,
    });
    trackChangedAtRef.current = Date.now();
    localProgressRef.current = data.positionMillis;

    setNowPlaying(prev => {
      if (!prev) return prev;

      updateProgressDOM(progressBarRef, debugTimeRef, data.positionMillis, prev.duration_ms);

      // Trigger server sync — images arrive via realtime subscription, no extra fetch needed
      console.log('[Sonos:BG] Track change — triggering server sync');
      addDebugLog?.(`🔄 Track change: ${data.trackName} — syncing server...`);
      (async () => {
        addDebugLog?.(`🖥️ Server img processing started`);
        await triggerServerSync();
        addDebugLog?.(`🖥️ Server img processing done — waiting for realtime update`);
      })();

      return {
        ...prev,
        track_name: data.trackName,
        artist_name: data.artistName ?? prev.artist_name,
        album_name: data.albumName ?? prev.album_name,
        playback_state: data.playbackState,
        position_ms: data.positionMillis,
      };
    });
  }, [setNowPlaying, setCurrentArtStatus, localProgressRef, trackChangedAtRef, bgSentRef, validBgBufferRef, onAlbumArtChangeRef, progressBarRef, debugTimeRef, addDebugLog]);

  return { handleTrackChange };
}
