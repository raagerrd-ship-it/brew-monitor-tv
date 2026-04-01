import { useCallback } from 'react';
import { NowPlaying, triggerServerSync, fetchNowPlayingImages, pushToBgBuffer, extractFileName, updateProgressDOM } from './types';
import { tvDebug } from '@/lib/tv-debug-log';

interface UseSonosTrackChangeParams {
  setNowPlaying: React.Dispatch<React.SetStateAction<NowPlaying | null>>;
  localProgressRef: React.MutableRefObject<number | null>;
  bgSentRef: React.MutableRefObject<string | null>;
  validBgBufferRef: React.MutableRefObject<string[]>;
  onAlbumArtChangeRef: React.MutableRefObject<((url: string | null, trackName?: string) => void) | undefined>;
  progressBarRef: React.RefObject<HTMLDivElement | null>;
  debugTimeRef: React.RefObject<HTMLSpanElement | null>;
  trackNameRef: React.RefObject<HTMLDivElement | null>;
  artistNameRef: React.RefObject<HTMLDivElement | null>;
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
    setNowPlaying, localProgressRef,
    bgSentRef, validBgBufferRef, onAlbumArtChangeRef,
    progressBarRef, debugTimeRef, trackNameRef, artistNameRef,
  } = params;

  const handleTrackChange = useCallback((data: TrackChangeData) => {
    localProgressRef.current = data.positionMillis;

    // Immediate DOM text swap (bypasses React render lag on weak hardware)
    if (trackNameRef.current) trackNameRef.current.textContent = data.trackName;
    if (artistNameRef.current) artistNameRef.current.textContent = data.artistName ?? '';

    setNowPlaying(prev => {
      if (!prev) return prev;

      updateProgressDOM(progressBarRef, debugTimeRef, data.positionMillis, prev.duration_ms);

      const nextBg = prev.next_bg_image_url;
      const nextArt = prev.next_album_art_url;
      // Only use preloaded images if they match the incoming track
      const preloadMatchesTrack = prev.next_track_name === data.trackName;
      const hasPreloaded = preloadMatchesTrack && !!nextBg;

      const prevBg = bgSentRef.current;

      if (hasPreloaded) {
        const cacheTag = prev.next_bg_cached === true
          ? '🗂️ sparad'
          : prev.next_bg_cached === false
            ? `🎨 genererad ${prev.next_bg_generation_ms ?? '?'}ms`
            : '';
        tvDebug('sonos', `🎵 → "${data.trackName}" ✅ ${cacheTag || 'förladdad'}`.trim());
        if (nextBg) {
          pushToBgBuffer(validBgBufferRef.current, nextBg);
          onAlbumArtChangeRef.current?.(nextBg, data.trackName);
          bgSentRef.current = nextBg;
        } else {
          // Had widget art but no bg — retry to get bg
          (async () => {
            for (let attempt = 0; attempt < 5; attempt++) {
              await new Promise(r => setTimeout(r, 3000));
              if (bgSentRef.current !== prevBg) break;
              try {
                await triggerServerSync();
                const result = await fetchNowPlayingImages();
                const isStale = result?.trackName && result.trackName !== data.trackName;
                if (isStale) {
                  tvDebug('sonos', `⏳ Bg-retry: DB har "${result.trackName}" (${attempt + 1}/5)`);
                  continue;
                }
                if (result?.bgImageUrl && result.bgImageUrl !== prevBg) {
                  pushToBgBuffer(validBgBufferRef.current, result.bgImageUrl);
                  onAlbumArtChangeRef.current?.(result.bgImageUrl, data.trackName);
                  bgSentRef.current = result.bgImageUrl;
                  setNowPlaying(cur => cur ? { ...cur, bg_image_url: result.bgImageUrl } : cur);
                  break;
                }
              } catch { /* next attempt */ }
              tvDebug('sonos', `🔄 Bg-retry ${attempt + 1}/5 (preload saknade bg)`);
            }
          })();
        }
      } else {
        tvDebug('sonos', `🎵 → "${data.trackName}" (väntar på bilder...)`);
        (async () => {
          // Wait 2s for RT to deliver images before expensive fallback
          await new Promise(r => setTimeout(r, 2000));
          if (bgSentRef.current !== prevBg) {
            tvDebug('sonos', `✅ RT levererade bilder under väntan`);
            return;
          }

          for (let attempt = 0; attempt < 5; attempt++) {
            if (attempt > 0) await new Promise(r => setTimeout(r, attempt < 3 ? 3000 : 5000));
            if (bgSentRef.current !== prevBg) break;
            try {
              await triggerServerSync();
              const result = await fetchNowPlayingImages();
              const dbTrack = result?.trackName;
              const dbMatchesPredicted = dbTrack === data.trackName;
              const dbMatchesPrevious = dbTrack === prev?.track_name;
              
              if (dbTrack && !dbMatchesPredicted && !dbMatchesPrevious) {
                // DB has a different NEW track — prediction was wrong, accept DB track
                tvDebug('sonos', `🔀 Prediktion fel: förväntade "${data.trackName}", DB har "${dbTrack}" — accepterar`);
                if (result?.bgImageUrl && result.bgImageUrl !== prevBg) {
                  pushToBgBuffer(validBgBufferRef.current, result.bgImageUrl);
                  onAlbumArtChangeRef.current?.(result.bgImageUrl, dbTrack);
                  bgSentRef.current = result.bgImageUrl;
                }
                break;
              }
              
              if (dbTrack && !dbMatchesPredicted && dbMatchesPrevious) {
                // DB still has the old track — wait for it to update
                tvDebug('sonos', `⏳ DB har fortfarande "${dbTrack}" (${attempt + 1}/5)`);
                continue;
              }

              if (result?.bgImageUrl && result.bgImageUrl !== prevBg) {
                pushToBgBuffer(validBgBufferRef.current, result.bgImageUrl);
                onAlbumArtChangeRef.current?.(result.bgImageUrl, data.trackName);
                bgSentRef.current = result.bgImageUrl;
              }
              if (result) {
                setNowPlaying(cur => cur ? {
                  ...cur,
                  ...(result.bgImageUrl ? { bg_image_url: result.bgImageUrl } : {}),
                  ...(result.albumArtUrl ? { album_art_url: result.albumArtUrl } : {}),
                } : cur);
              }
              if (bgSentRef.current !== prevBg) break;
            } catch { /* next attempt */ }
            tvDebug('sonos', `🔄 Bg-retry ${attempt + 1}/5`);
          }
        })();
      }

      return {
        ...prev,
        track_name: data.trackName,
        artist_name: data.artistName ?? prev.artist_name,
        album_name: data.albumName ?? prev.album_name,
        playback_state: data.playbackState,
        position_ms: data.positionMillis,
        ...(nextBg ? { bg_image_url: nextBg } : {}),
        ...(nextArt ? { album_art_url: nextArt } : {}),
        next_bg_image_url: null,
        next_album_art_url: null,
        next_track_name: null,
        next_artist_name: null,
      };
    });
  }, [setNowPlaying, localProgressRef, bgSentRef, validBgBufferRef, onAlbumArtChangeRef, progressBarRef, debugTimeRef, trackNameRef, artistNameRef]);

  return { handleTrackChange };
}
