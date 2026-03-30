import { useEffect, useRef } from 'react';
import { tvDebug } from '@/lib/tv-debug-log';
import {
  NowPlaying, isSeqStale,
  PLAYBACK_POLL_TIMEOUT, PREDICTIVE_THRESHOLD_MS, PREDICTIVE_MARGIN_MS,
  PREDICTIVE_RETRY_INTERVAL_MS, PREDICTIVE_MAX_RETRIES,
  updateProgressDOM, triggerServerSync, fetchNowPlayingImages, pushToBgBuffer,
} from './types';

interface TrackChangeData {
  trackName: string;
  artistName?: string | null;
  albumName?: string | null;
  playbackState: string;
  positionMillis: number;
}

interface UseSonosPlaybackTickerParams {
  nowPlaying: NowPlaying | null;
  nowPlayingRef: React.MutableRefObject<NowPlaying | null>;
  handleTrackChange: (data: TrackChangeData) => void;
  localProgressRef: React.MutableRefObject<number | null>;
  lastPredictivePollRef: React.MutableRefObject<number>;
  predictiveScheduledRef: React.MutableRefObject<boolean>;
  bgSentRef: React.MutableRefObject<string | null>;
  validBgBufferRef: React.MutableRefObject<string[]>;
  onAlbumArtChangeRef: React.MutableRefObject<((url: string | null, trackName?: string) => void) | undefined>;
  progressBarRef: React.RefObject<HTMLDivElement | null>;
  debugTimeRef: React.RefObject<HTMLSpanElement | null>;
  trackChangeOffsetMs?: number;
  acceptedSeqRef: React.MutableRefObject<number>;
  swappedFromRef: React.MutableRefObject<{ trackName: string; ts: number } | null>;
}

/**
 * 1s ticker: progress bar + predictive swap.
 * Uses monotonic seq-gate. At predictive swap, bumps acceptedSeqRef
 * to block all stale data until backend confirms.
 */
export function useSonosPlaybackTicker(params: UseSonosPlaybackTickerParams) {
  const {
    nowPlaying, nowPlayingRef, handleTrackChange,
    localProgressRef,
    lastPredictivePollRef, predictiveScheduledRef,
    bgSentRef, validBgBufferRef, onAlbumArtChangeRef,
    progressBarRef, debugTimeRef, trackChangeOffsetMs,
    acceptedSeqRef, swappedFromRef,
  } = params;

  const handleTrackChangeRef = useRef(handleTrackChange);
  handleTrackChangeRef.current = handleTrackChange;

  useEffect(() => {
    if (!nowPlaying?.track_name || nowPlaying.playback_state === 'PLAYBACK_STATE_IDLE' || !nowPlaying.duration_ms) return;

    const duration = nowPlaying.duration_ms;
    const trackName = nowPlaying.track_name;
    let predictiveTimer: ReturnType<typeof setTimeout> | null = null;

    const pollForNewTrack = async (retriesLeft: number) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), PLAYBACK_POLL_TIMEOUT);
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sonos-playback-status`,
          {
            headers: {
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
              'Content-Type': 'application/json',
            },
            signal: controller.signal,
          }
        );
        clearTimeout(timeout);
        if (!response.ok) return;
        const data = await response.json();
        if (!data.ok) return;

        lastPredictivePollRef.current = Date.now();

        if (data.trackName && data.trackName !== trackName) {
          // Seq-gate: if polled data has lower seq than accepted, retry
          if (isSeqStale(acceptedSeqRef.current, data.trackSeq)) {
            tvDebug('sonos', `🔒 Ticker poll rejected: seq ${data.trackSeq} < accepted ${acceptedSeqRef.current}`);
            if (retriesLeft > 0) {
              predictiveTimer = setTimeout(() => pollForNewTrack(retriesLeft - 1), PREDICTIVE_RETRY_INTERVAL_MS);
            }
            return;
          }
          // Update accepted seq from backend
          if (typeof data.trackSeq === 'number' && data.trackSeq > acceptedSeqRef.current) {
            acceptedSeqRef.current = data.trackSeq;
          }
          handleTrackChangeRef.current(data);
        } else if (retriesLeft > 0) {
          predictiveTimer = setTimeout(() => pollForNewTrack(retriesLeft - 1), PREDICTIVE_RETRY_INTERVAL_MS);
        } else {
          localProgressRef.current = data.positionMillis;
          updateProgressDOM(progressBarRef, debugTimeRef, data.positionMillis, duration);
        }
      } catch { /* ignore */ }
    };

    const ticker = window.setInterval(() => {
      const prev = localProgressRef.current;
      if (prev === null) return;

      const currentState = nowPlayingRef?.current?.playback_state ?? nowPlaying.playback_state;
      const isPlaying = currentState === 'PLAYBACK_STATE_PLAYING';
      const next = isPlaying ? Math.min(prev + 1000, duration) : prev;
      localProgressRef.current = next;
      updateProgressDOM(progressBarRef, debugTimeRef, next, duration);

      const remaining = duration - next;
      const offsetMs = trackChangeOffsetMs ?? PREDICTIVE_MARGIN_MS;

      if (remaining <= PREDICTIVE_THRESHOLD_MS && remaining > 0 && !predictiveScheduledRef.current) {
        predictiveScheduledRef.current = true;

        // Preload next images into browser cache
        const current = nowPlayingRef?.current;
        const preloadUrls = [current?.next_widget_art_url, current?.next_bg_image_url].filter(Boolean) as string[];
        if (preloadUrls.length > 0) {
          preloadUrls.forEach(url => { const img = new Image(); img.src = url; });
          tvDebug('sonos', `🖼️ Preload ${preloadUrls.length} bild(er) ${(remaining / 1000).toFixed(1)}s innan slut`);
        }

        const delay = Math.max(remaining - offsetMs, 100);
        tvDebug('sonos', `🔮 Swap om ${(delay / 1000).toFixed(1)}s`);

        predictiveTimer = setTimeout(() => {
          const snap = nowPlayingRef?.current;
          if (snap?.next_track_name) {
            // Record what we're swapping FROM for revert guard
            swappedFromRef.current = { trackName: trackName, ts: Date.now() };
            tvDebug('sonos', `🔮 Swap → "${snap.next_track_name}"`);
            // Bump seq to block all stale data until backend confirms
            acceptedSeqRef.current = (snap.track_seq ?? acceptedSeqRef.current) + 1;
            tvDebug('sonos', `🔮 Seq bumped to ${acceptedSeqRef.current}`);
            if (snap.next_bg_image_url) { const img = new Image(); img.src = snap.next_bg_image_url; }
            handleTrackChangeRef.current({
              trackName: snap.next_track_name,
              artistName: snap.next_artist_name,
              playbackState: 'PLAYBACK_STATE_PLAYING',
              positionMillis: 0,
            });
          } else {
            tvDebug('sonos', `🔮 Ingen next-data — pollar`);
            // Bump seq before polling too
            acceptedSeqRef.current = (snap?.track_seq ?? acceptedSeqRef.current) + 1;
            pollForNewTrack(PREDICTIVE_MAX_RETRIES);
          }
        }, delay);
      }

      // Safety-net: track ended but no change detected
      if (remaining <= 0 && predictiveScheduledRef.current) {
        tvDebug('sonos', `⚠️ Låten slut utan trackbyte — pollar`);
        predictiveScheduledRef.current = false;
        pollForNewTrack(PREDICTIVE_MAX_RETRIES);
      }

      // Watchdog: no background sent
      if (isPlaying && bgSentRef.current === null && next % 10000 < 1000) {
        tvDebug('sonos', `🔍 Ingen bakgrund — försöker hämta`);
        (async () => {
          try {
            await triggerServerSync();
            const result = await fetchNowPlayingImages();
            const currentTrack = nowPlayingRef.current?.track_name;
            const isStale = result?.trackName && currentTrack && result.trackName !== currentTrack;
            if (isStale) {
              tvDebug('sonos', `⏳ Watchdog: DB har "${result.trackName}", väntar på "${currentTrack}"`);
              return;
            }
            if (result?.bgImageUrl) {
              pushToBgBuffer(validBgBufferRef.current, result.bgImageUrl);
              onAlbumArtChangeRef.current?.(result.bgImageUrl, nowPlayingRef.current?.track_name ?? undefined);
              bgSentRef.current = result.bgImageUrl;
              tvDebug('sonos', `✅ Bakgrund hämtad via watchdog`);
            }
          } catch { /* ignore */ }
        })();
      }
    }, 1000);

    return () => {
      clearInterval(ticker);
      if (predictiveTimer) clearTimeout(predictiveTimer);
      predictiveScheduledRef.current = false;
    };
  }, [nowPlaying?.track_name, nowPlaying?.playback_state, nowPlaying?.duration_ms]);
}
