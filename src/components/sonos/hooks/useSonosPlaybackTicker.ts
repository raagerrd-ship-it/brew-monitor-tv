import { useEffect, useRef } from 'react';
import {
  NowPlaying, PrefetchStatus,
  PLAYBACK_POLL_TIMEOUT, PREDICTIVE_THRESHOLD_MS, PREDICTIVE_MARGIN_MS,
  PREDICTIVE_RETRY_INTERVAL_MS, PREDICTIVE_MAX_RETRIES,
  pushToBgBuffer, updateProgressDOM,
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
  setNowPlaying: React.Dispatch<React.SetStateAction<NowPlaying | null>>;
  setPrefetchStatus: (status: PrefetchStatus) => void;
  handleTrackChange: (data: TrackChangeData, earlySwapped: boolean) => void;
  localProgressRef: React.MutableRefObject<number | null>;
  trackChangedAtRef: React.MutableRefObject<number>;
  earlySwapDoneRef: React.MutableRefObject<boolean>;
  lastPredictivePollRef: React.MutableRefObject<number>;
  predictiveScheduledRef: React.MutableRefObject<boolean>;
  prefetchTriggeredForTrackRef: React.MutableRefObject<string | null>;
  trackChangeOffsetRef: React.MutableRefObject<number>;
  prefetchSecondsRef: React.MutableRefObject<number>;
  bgSentRef: React.MutableRefObject<string | null>;
  validBgBufferRef: React.MutableRefObject<string[]>;
  onAlbumArtChangeRef: React.MutableRefObject<((url: string | null) => void) | undefined>;
  progressBarRef: React.RefObject<HTMLDivElement | null>;
  debugTimeRef: React.RefObject<HTMLSpanElement | null>;
}

/**
 * 1-second ticker handling:
 * - Progress bar updates via DOM ref (zero re-renders)
 * - Predictive polling near track end
 * - Prefetch trigger for next track
 * - Early swap of images before track ends
 */
export function useSonosPlaybackTicker(params: UseSonosPlaybackTickerParams) {
  const {
    nowPlaying, setNowPlaying, setPrefetchStatus, handleTrackChange,
    localProgressRef, trackChangedAtRef, earlySwapDoneRef,
    lastPredictivePollRef, predictiveScheduledRef, prefetchTriggeredForTrackRef,
    trackChangeOffsetRef, prefetchSecondsRef, bgSentRef, validBgBufferRef, onAlbumArtChangeRef,
    progressBarRef, debugTimeRef,
  } = params;

  // Stable ref for handleTrackChange to avoid re-creating the effect
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
          handleTrackChangeRef.current(data, earlySwapDoneRef.current);
        } else if (retriesLeft > 0) {
          predictiveTimer = setTimeout(() => pollForNewTrack(retriesLeft - 1), PREDICTIVE_RETRY_INTERVAL_MS);
        } else {
          // No track change after all retries — just sync position
          localProgressRef.current = data.positionMillis;
          updateProgressDOM(progressBarRef, debugTimeRef, data.positionMillis, duration);
        }
      } catch {
        // ignore
      }
    };

    const ticker = window.setInterval(() => {
      try {
        const prev = localProgressRef.current;
        if (prev === null) return;

        // Only advance progress when actually playing (not during PAUSED/BUFFERING)
        const isPlaying = nowPlaying.playback_state === 'PLAYBACK_STATE_PLAYING';
        const next = isPlaying ? Math.min(prev + 1000, duration) : prev;
        localProgressRef.current = next;

        // Direct DOM update — zero React re-renders
        updateProgressDOM(progressBarRef, debugTimeRef, next, duration);

        const timeRemaining = duration - next;

        // Early swap: switch images before track ends based on user offset
        const offsetMs = trackChangeOffsetRef.current * 1000;
        if (offsetMs > 0 && timeRemaining <= offsetMs && timeRemaining > 0 && !earlySwapDoneRef.current) {
          trackChangedAtRef.current = Date.now();
          setNowPlaying(prev => {
            if (!prev?.next_album_art_url) return prev;
            earlySwapDoneRef.current = true;
            setPrefetchStatus('loaded');
            const newArtUrl = prev.next_album_art_url || prev.album_art_url;
            const newBgUrl = prev.next_bg_image_url || prev.bg_image_url;
            pushToBgBuffer(validBgBufferRef.current, newBgUrl || newArtUrl);
            onAlbumArtChangeRef.current?.(newBgUrl || newArtUrl);
            bgSentRef.current = newBgUrl || newArtUrl;
            return {
              ...prev,
              album_art_url: newArtUrl,
              bg_image_url: newBgUrl,
              next_album_art_url: null,
              next_bg_image_url: null,
            };
          });
        }

        // Prefetch: trigger server sync before end (once per track)
        if (timeRemaining <= prefetchSecondsRef.current * 1000 && timeRemaining > 0 && prefetchTriggeredForTrackRef.current !== trackName) {
          prefetchTriggeredForTrackRef.current = trackName;
          setPrefetchStatus('fetching');
          console.log(`[Sonos] Prefetching next track data (${Math.round(timeRemaining / 1000)}s remaining)`);
          const ac = new AbortController();
          const t = setTimeout(() => ac.abort(), 15000);
          fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-sonos-now-playing`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
              'Content-Type': 'application/json',
            },
            signal: ac.signal,
          }).then(res => { if (res.ok) setPrefetchStatus('ready'); })
            .catch(() => {})
            .finally(() => clearTimeout(t));
        }

        // Predictive poll: schedule when <10s remain (once per track)
        if (timeRemaining <= PREDICTIVE_THRESHOLD_MS && timeRemaining > 0 && !predictiveScheduledRef.current) {
          predictiveScheduledRef.current = true;
          const delay = Math.max(timeRemaining + PREDICTIVE_MARGIN_MS, 100);
          predictiveTimer = setTimeout(() => pollForNewTrack(PREDICTIVE_MAX_RETRIES), delay);
        }
      } catch (err) {
        console.error('[Sonos] Ticker error:', err);
      }
    }, 1000);

    return () => {
      clearInterval(ticker);
      if (predictiveTimer) clearTimeout(predictiveTimer);
      predictiveScheduledRef.current = false;
      earlySwapDoneRef.current = false;
      setPrefetchStatus('idle');
    };
  }, [nowPlaying?.track_name, nowPlaying?.playback_state, nowPlaying?.duration_ms]);
}
