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
  addDebugLog?: (event: string) => void;
}

/**
 * 5-second polling of sonos-playback-status for position sync and metadata updates.
 * Runs during PLAYING only. Art URLs come from init + realtime, not polling.
 */
export function useSonosClientPolling(params: UseSonosClientPollingParams) {
  const {
    isConnected, showWidget, nowPlaying, nowPlayingRef,
    setNowPlaying, handleTrackChange,
    localProgressRef, lastPredictivePollRef, trackChangedAtRef,
    progressBarRef, debugTimeRef, addDebugLog,
  } = params;

  useEffect(() => {
    if (!isConnected || !showWidget) return;
    if (!nowPlaying?.track_name || nowPlaying.playback_state === 'PLAYBACK_STATE_IDLE' || nowPlaying.playback_state === 'PLAYBACK_STATE_PAUSED') return;

    const poll = async () => {
      // Skip if a predictive poll just ran
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

        // Update position — only hard-reset if drift > 3s to avoid visible jumps
        const localPos = localProgressRef.current ?? 0;
        const drift = Math.abs(data.positionMillis - localPos);
        if (drift > 3000) {
          localProgressRef.current = data.positionMillis;
        }
        const duration = data.durationMillis ?? nowPlaying.duration_ms;
        const displayPos = localProgressRef.current ?? data.positionMillis;
        updateProgressDOM(progressBarRef, debugTimeRef, displayPos, duration);

        if (data.trackName) {
          const currentNpSnap = nowPlayingRef.current;
          const trackChanged = (currentNpSnap?.track_name ?? nowPlaying.track_name) !== data.trackName;
          const msSinceTrackChange = Date.now() - trackChangedAtRef.current;
          const inCooldown = msSinceTrackChange < 15000;
          if (trackChanged && !inCooldown) {
            addDebugLog?.(`📡 Poll: track changed → ${data.trackName}`);
            handleTrackChange(data);
          } else if (trackChanged && inCooldown) {
            // Server still reports old track during predictive swap cooldown — ignore
            tvDebug('sonos', `⏳ Poll ignorerad under cooldown (${Math.round(msSinceTrackChange / 1000)}s): server="${data.trackName}", lokal="${currentNpSnap?.track_name}"`);
            console.log(`[Sonos:Poll] ⏳ Ignored stale track during cooldown (${Math.round(msSinceTrackChange / 1000)}s): server="${data.trackName}", local="${currentNpSnap?.track_name}"`);
          } else {
             // Same track — update metadata, state, and next-track info (art URLs come from init + realtime)
            setNowPlaying(prev => {
              if (!prev) return prev;
              const artistChanged = prev.artist_name !== data.artistName;
              const albumChanged = prev.album_name !== data.albumName;
              const stateChanged = prev.playback_state !== data.playbackState;
              const durationChanged = duration && prev.duration_ms !== duration;
              const nextChanged = data.nextTrackName && data.nextTrackName !== prev.next_track_name;

              if (!artistChanged && !albumChanged && !stateChanged && !durationChanged && !nextChanged) return prev;

              if (nextChanged) {
                addDebugLog?.(`📡 Poll: next track → ${data.nextTrackName}`);
              }

              return {
                ...prev,
                artist_name: data.artistName ?? prev.artist_name,
                album_name: data.albumName ?? prev.album_name,
                playback_state: data.playbackState,
                position_ms: data.positionMillis,
                duration_ms: duration ?? prev.duration_ms,
                ...(nextChanged ? {
                  next_track_name: data.nextTrackName,
                  next_artist_name: data.nextArtistName ?? null,
                  next_album_art_url: data.nextAlbumArtUrl ?? null,
                } : {}),
              };
            });
          }
        } else if (data.playbackState !== nowPlaying.playback_state) {
          setNowPlaying(prev => prev ? { ...prev, playback_state: data.playbackState, position_ms: data.positionMillis } : prev);
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
