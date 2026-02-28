import { useCallback } from 'react';
import { NowPlaying, triggerServerSync, pushToBgBuffer, updateProgressDOM } from './types';
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

  const handleTrackChange = useCallback((data: TrackChangeData) => {
    const t0 = performance.now();
    tvDebug('sonos', `🎵 Låtbyte: "${data.trackName}"`, 'track-change');
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
      tvDebug('sonos', `🔄 Hämtar låtbild...`, 'art-fetch');
      console.log('[Sonos:TC] 🔄 Triggering server sync for new art...');
      (async () => {
        const syncT0 = performance.now();
        try {
          await triggerServerSync();
          const ms = Math.round(performance.now() - syncT0);
          tvDebug('sonos', `✅ Server sync klar (${ms}ms)`, 'art-fetch');
          console.log(`[Sonos:TC] ✅ Server sync completed in ${ms}ms — waiting for realtime art update`);
        } catch (e: any) {
          const ms = Math.round(performance.now() - syncT0);
          tvDebug('sonos', `❌ Server sync fail (${ms}ms)`, 'art-fetch');
          console.error(`[Sonos:TC] ❌ Server sync failed after ${ms}ms:`, e?.message || e);
        }
      })();

      const ms = Math.round(performance.now() - t0);
      console.log(`[Sonos:TC] State update applied in ${ms}ms`);
      tvDebug('sonos', `📝 Widget-text bytt: "${data.trackName}" (${ms}ms)`, 'track-change');
      // Use preloaded next-track images if available
      const nextWidget = prev.next_widget_art_url;
      const nextBg = prev.next_bg_image_url;
      const nextArt = prev.next_album_art_url;
      if (nextWidget || nextBg) {
        tvDebug('sonos', `🖼️ Använder förladdat: widget=${!!nextWidget}, bg=${!!nextBg}`);
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
