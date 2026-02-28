import { useEffect } from 'react';
import { tvDebug } from '@/lib/tv-debug-log';
import {
  NowPlaying,
  PLAYBACK_POLL_INTERVAL, PLAYBACK_POLL_TIMEOUT, PREDICTIVE_COOLDOWN_MS,
  updateProgressDOM,
} from './types';

interface TrackChangeData {
  trackName: string;
  artistName?: string | null;
  albumName?: string | null;
  playbackState: string;
  positionMillis: number;
}

interface UseSonosClientPollingParams {
  isConnected: boolean;
  showWidget: boolean;
  nowPlaying: NowPlaying | null;
  nowPlayingRef: React.MutableRefObject<NowPlaying | null>;
  setNowPlaying: React.Dispatch<React.SetStateAction<NowPlaying | null>>;
  handleTrackChange: (data: TrackChangeData) => void;
  localProgressRef: React.MutableRefObject<number | null>;
  lastPredictivePollRef: React.MutableRefObject<number>;
  trackChangedAtRef: React.MutableRefObject<number>;
  progressBarRef: React.RefObject<HTMLDivElement | null>;
  debugTimeRef: React.RefObject<HTMLSpanElement | null>;
}

/**
 * 5s poll for position sync + next track metadata.
 * No art URLs — those come from RT.
 */
export function useSonosClientPolling(params: UseSonosClientPollingParams) {
  const {
    isConnected, showWidget, nowPlaying, nowPlayingRef,
    setNowPlaying, handleTrackChange,
    localProgressRef, lastPredictivePollRef, trackChangedAtRef,
    progressBarRef, debugTimeRef,
  } = params;

  useEffect(() => {
    if (!isConnected || !showWidget) return;
    if (!nowPlaying?.track_name || nowPlaying.playback_state === 'PLAYBACK_STATE_IDLE' || nowPlaying.playback_state === 'PLAYBACK_STATE_PAUSED') return;

    const poll = async () => {
      if (Date.now() - lastPredictivePollRef.current < PREDICTIVE_COOLDOWN_MS) return;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PLAYBACK_POLL_TIMEOUT);

      try {
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

        // Position drift correction (>3s)
        const drift = Math.abs(data.positionMillis - (localProgressRef.current ?? 0));
        if (drift > 3000) localProgressRef.current = data.positionMillis;

        const duration = data.durationMillis ?? nowPlaying.duration_ms;
        updateProgressDOM(progressBarRef, debugTimeRef, localProgressRef.current ?? data.positionMillis, duration);

        if (!data.trackName) {
          if (data.playbackState !== nowPlaying.playback_state) {
            setNowPlaying(prev => prev ? { ...prev, playback_state: data.playbackState } : prev);
          }
          return;
        }

        const current = nowPlayingRef.current;
        const trackChanged = (current?.track_name ?? nowPlaying.track_name) !== data.trackName;
        const msSinceTC = Date.now() - trackChangedAtRef.current;

        if (trackChanged && msSinceTC >= 15000) {
          handleTrackChange(data);
        } else if (!trackChanged) {
          // Same track — update metadata + next track info
          setNowPlaying(prev => {
            if (!prev) return prev;
            const nextChanged = data.nextTrackName && data.nextTrackName !== prev.next_track_name;
            const stateChanged = prev.playback_state !== data.playbackState;
            const durationChanged = duration && prev.duration_ms !== duration;

            if (!nextChanged && !stateChanged && !durationChanged) return prev;

            return {
              ...prev,
              artist_name: data.artistName ?? prev.artist_name,
              album_name: data.albumName ?? prev.album_name,
              playback_state: data.playbackState,
              duration_ms: duration ?? prev.duration_ms,
              ...(nextChanged ? {
                next_track_name: data.nextTrackName,
                next_artist_name: data.nextArtistName ?? null,
                next_album_art_url: data.nextAlbumArtUrl ?? null,
              } : {}),
            };
          });
        }
      } catch {
        // ignore
      } finally {
        clearTimeout(timeout);
      }
    };

    poll();
    const interval = setInterval(poll, PLAYBACK_POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [isConnected, showWidget, nowPlaying?.track_name, nowPlaying?.playback_state]);
}
