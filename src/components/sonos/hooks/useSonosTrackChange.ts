import { useCallback } from 'react';
import { NowPlaying, RollbackLock, triggerServerSync, fetchNowPlayingImages, pushToBgBuffer, extractFileName, updateProgressDOM } from './types';
import { tvDebug } from '@/lib/tv-debug-log';

const ROLLBACK_LOCK_DURATION_MS = 15000;

interface UseSonosTrackChangeParams {
  setNowPlaying: React.Dispatch<React.SetStateAction<NowPlaying | null>>;
  localProgressRef: React.MutableRefObject<number | null>;
  trackChangedAtRef: React.MutableRefObject<number>;
  bgSentRef: React.MutableRefObject<string | null>;
  validBgBufferRef: React.MutableRefObject<string[]>;
  onAlbumArtChangeRef: React.MutableRefObject<((url: string | null, trackName?: string) => void) | undefined>;
  progressBarRef: React.RefObject<HTMLDivElement | null>;
  debugTimeRef: React.RefObject<HTMLSpanElement | null>;
  trackNameRef: React.RefObject<HTMLDivElement | null>;
  artistNameRef: React.RefObject<HTMLDivElement | null>;
  rollbackLockRef: React.MutableRefObject<RollbackLock | null>;
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
    progressBarRef, debugTimeRef, trackNameRef, artistNameRef,
    rollbackLockRef,
  } = params;

  const handleTrackChange = useCallback((data: TrackChangeData) => {
    // Set rollback lock: block fromTrack for 15s
    const currentTrack = trackNameRef.current?.textContent ?? '';
    if (currentTrack && currentTrack !== data.trackName) {
      rollbackLockRef.current = {
        fromTrack: currentTrack,
        toTrack: data.trackName,
        lockUntil: Date.now() + ROLLBACK_LOCK_DURATION_MS,
      };
      tvDebug('sonos', `🔒 Rollback lock: "${currentTrack}" → "${data.trackName}" (${ROLLBACK_LOCK_DURATION_MS / 1000}s)`);
    }
    trackChangedAtRef.current = Date.now();
    localProgressRef.current = data.positionMillis;

    // Immediate DOM text swap (bypasses React render lag on weak hardware)
    if (trackNameRef.current) trackNameRef.current.textContent = data.trackName;
    if (artistNameRef.current) artistNameRef.current.textContent = data.artistName ?? '';

    setNowPlaying(prev => {
      if (!prev) return prev;

      updateProgressDOM(progressBarRef, debugTimeRef, data.positionMillis, prev.duration_ms);

      const nextBg = prev.next_bg_image_url;
      const nextWidget = prev.next_widget_art_url;
      const nextArt = prev.next_album_art_url;
      // Only use preloaded images if they match the incoming track
      const preloadMatchesTrack = prev.next_track_name === data.trackName;
      const hasPreloaded = preloadMatchesTrack && !!(nextWidget || nextBg);

      const prevBg = bgSentRef.current;

      if (hasPreloaded) {
        tvDebug('sonos', `🎵 → "${data.trackName}" ✅ ${extractFileName(nextBg)}`);
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
              // Verify the DB images actually match the current track
              const isStale = result?.trackName && result.trackName !== data.trackName;
              if (isStale) {
                tvDebug('sonos', `⏳ DB har "${result.trackName}" — väntar på "${data.trackName}" (${attempt + 1}/5)`);
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
                  ...(result.widgetArtUrl ? { widget_art_url: result.widgetArtUrl } : {}),
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
  }, [setNowPlaying, localProgressRef, trackChangedAtRef, bgSentRef, validBgBufferRef, onAlbumArtChangeRef, progressBarRef, debugTimeRef, trackNameRef, artistNameRef, rollbackLockRef]);

  return { handleTrackChange };
}
