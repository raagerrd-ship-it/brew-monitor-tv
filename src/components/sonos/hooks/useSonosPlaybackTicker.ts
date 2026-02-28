import { useEffect, useRef } from 'react';
import { tvDebug } from '@/lib/tv-debug-log';
import {
  NowPlaying,
  PLAYBACK_POLL_TIMEOUT, PREDICTIVE_THRESHOLD_MS, PREDICTIVE_MARGIN_MS,
  PREDICTIVE_RETRY_INTERVAL_MS, PREDICTIVE_MAX_RETRIES,
  updateProgressDOM,
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
  setNowPlaying: React.Dispatch<React.SetStateAction<NowPlaying | null>>;
  handleTrackChange: (data: TrackChangeData) => void;
  addDebugLog?: (event: string) => void;
  localProgressRef: React.MutableRefObject<number | null>;
  trackChangedAtRef: React.MutableRefObject<number>;
  lastPredictivePollRef: React.MutableRefObject<number>;
  predictiveScheduledRef: React.MutableRefObject<boolean>;
  trackChangeOffsetRef: React.MutableRefObject<number>;
  progressBarRef: React.RefObject<HTMLDivElement | null>;
  debugTimeRef: React.RefObject<HTMLSpanElement | null>;
}

/**
 * 1-second ticker handling:
 * - Progress bar updates via DOM ref (zero re-renders)
 * - Predictive polling near track end
 */
export function useSonosPlaybackTicker(params: UseSonosPlaybackTickerParams) {
  const {
    nowPlaying, nowPlayingRef, setNowPlaying, handleTrackChange,
    localProgressRef, trackChangedAtRef,
    lastPredictivePollRef, predictiveScheduledRef, trackChangeOffsetRef,
    progressBarRef, debugTimeRef, addDebugLog,
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
          addDebugLog?.(`🔄 Predictive poll confirmed: ${data.trackName}`);
          tvDebug('sonos', `🔮 Predictive poll bekräftade nytt spår: "${data.trackName}"`);
          handleTrackChangeRef.current(data);
        } else if (retriesLeft > 0) {
          tvDebug('sonos', `🔮 Retry ${PREDICTIVE_MAX_RETRIES - retriesLeft + 1}/${PREDICTIVE_MAX_RETRIES} — samma spår, försöker igen om ${PREDICTIVE_RETRY_INTERVAL_MS/1000}s`);
          predictiveTimer = setTimeout(() => pollForNewTrack(retriesLeft - 1), PREDICTIVE_RETRY_INTERVAL_MS);
        } else {
          tvDebug('sonos', `🔮 Retries slut — ingen ny låt detekterad`);
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

        const currentState = nowPlayingRef?.current?.playback_state ?? nowPlaying.playback_state;
        const isPlaying = currentState === 'PLAYBACK_STATE_PLAYING';
        const next = isPlaying ? Math.min(prev + 1000, duration) : prev;
        localProgressRef.current = next;

        updateProgressDOM(progressBarRef, debugTimeRef, next, duration);

        const timeRemaining = duration - next;

        // Predictive swap: schedule when <10s remain (once per track)
        // Use track change offset from settings (seconds → ms), fallback to PREDICTIVE_MARGIN_MS
        const offsetMs = trackChangeOffsetRef.current > 0
          ? trackChangeOffsetRef.current * 1000
          : PREDICTIVE_MARGIN_MS;

        if (timeRemaining <= PREDICTIVE_THRESHOLD_MS && timeRemaining > 0 && !predictiveScheduledRef.current) {
          predictiveScheduledRef.current = true;
          const delay = Math.max(timeRemaining - offsetMs, 100);
          tvDebug('sonos', `🔮 Predictive swap om ${(delay / 1000).toFixed(1)}s (${(timeRemaining / 1000).toFixed(0)}s kvar, offset: ${trackChangeOffsetRef.current}s)`);
          addDebugLog?.(`🔮 Predictive swap scheduled in ${(delay / 1000).toFixed(1)}s (offset: ${trackChangeOffsetRef.current}s)`);

          // Preload next track's images if available
          const current = nowPlayingRef?.current;
          if (current?.next_widget_art_url || current?.next_bg_image_url) {
            const urls = [current.next_widget_art_url, current.next_bg_image_url].filter(Boolean) as string[];
            tvDebug('sonos', `🖼️ Förladdar ${urls.length} bilder för nästa låt`);
            urls.forEach(url => {
              const img = new Image();
              img.src = url;
            });
          }

          predictiveTimer = setTimeout(() => {
            // If we have pre-populated next track data, apply it immediately
            const snap = nowPlayingRef?.current;
            if (snap?.next_track_name) {
              tvDebug('sonos', `🔮 Predictive swap: byter till "${snap.next_track_name}" (${trackChangeOffsetRef.current}s före låtslut)`);
              addDebugLog?.(`🔮 Predictive swap → ${snap.next_track_name}`);
              handleTrackChangeRef.current({
                trackName: snap.next_track_name,
                artistName: snap.next_artist_name,
                playbackState: 'PLAYBACK_STATE_PLAYING',
                positionMillis: 0,
              });
            } else {
              // No next track data available — fall back to polling
              tvDebug('sonos', `🔮 Ingen nästa-låt-data — pollar istället`);
              pollForNewTrack(PREDICTIVE_MAX_RETRIES);
            }
          }, delay);
        }
      } catch (err) {
        console.error('[Sonos] Ticker error:', err);
      }
    }, 1000);

    return () => {
      clearInterval(ticker);
      if (predictiveTimer) clearTimeout(predictiveTimer);
      predictiveScheduledRef.current = false;
    };
  }, [nowPlaying?.track_name, nowPlaying?.playback_state, nowPlaying?.duration_ms]);
}
