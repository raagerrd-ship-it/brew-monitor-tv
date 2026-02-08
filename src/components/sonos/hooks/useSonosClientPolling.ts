import { useEffect } from 'react';
import {
  NowPlaying,
  PLAYBACK_POLL_INTERVAL, PLAYBACK_POLL_TIMEOUT, PREDICTIVE_COOLDOWN_MS,
  stripQuery, pushToBgBuffer, updateProgressDOM,
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
  displayedArtUrl: string | null;
  setNowPlaying: React.Dispatch<React.SetStateAction<NowPlaying | null>>;
  handleTrackChange: (data: TrackChangeData, earlySwapped: boolean) => void;
  localProgressRef: React.MutableRefObject<number | null>;
  lastPredictivePollRef: React.MutableRefObject<number>;
  bgSentRef: React.MutableRefObject<string | null>;
  validBgBufferRef: React.MutableRefObject<string[]>;
  onAlbumArtChangeRef: React.MutableRefObject<((url: string | null) => void) | undefined>;
  progressBarRef: React.RefObject<HTMLDivElement | null>;
  debugTimeRef: React.RefObject<HTMLSpanElement | null>;
}

/**
 * 5-second polling of sonos-playback-status for position sync and metadata updates.
 * Runs during PLAYING and PAUSED (stops only for IDLE).
 * Includes background sync safeguard.
 */
export function useSonosClientPolling(params: UseSonosClientPollingParams) {
  const {
    isConnected, showWidget, nowPlaying, nowPlayingRef, displayedArtUrl,
    setNowPlaying, handleTrackChange,
    localProgressRef, lastPredictivePollRef,
    bgSentRef, validBgBufferRef, onAlbumArtChangeRef,
    progressBarRef, debugTimeRef,
  } = params;

  useEffect(() => {
    if (!isConnected || !showWidget) return;
    if (!nowPlaying?.track_name || nowPlaying.playback_state === 'PLAYBACK_STATE_IDLE') return;

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

        // Update position via DOM ref
        localProgressRef.current = data.positionMillis;
        const duration = data.durationMillis ?? nowPlaying.duration_ms;
        updateProgressDOM(progressBarRef, debugTimeRef, data.positionMillis, duration);

        if (data.trackName) {
          const trackChanged = nowPlaying.track_name !== data.trackName;
          if (trackChanged) {
            handleTrackChange(data, false);
          } else {
            // Same track — update metadata and state if changed
            setNowPlaying(prev => {
              if (!prev) return prev;
              const artistChanged = prev.artist_name !== data.artistName;
              const albumChanged = prev.album_name !== data.albumName;
              const stateChanged = prev.playback_state !== data.playbackState;
              const durationChanged = duration && prev.duration_ms !== duration;
              if (!artistChanged && !albumChanged && !stateChanged && !durationChanged) return prev;
              return {
                ...prev,
                artist_name: data.artistName ?? prev.artist_name,
                album_name: data.albumName ?? prev.album_name,
                playback_state: data.playbackState,
                position_ms: data.positionMillis,
                duration_ms: duration ?? prev.duration_ms,
              };
            });
          }
        } else if (data.playbackState !== nowPlaying.playback_state) {
          // No track name but playback state changed (e.g. IDLE)
          setNowPlaying(prev => prev ? { ...prev, playback_state: data.playbackState, position_ms: data.positionMillis } : prev);
        }

        // Background sync safeguard — use ref to avoid stale closure
        const currentNp = nowPlayingRef.current;
        const sentStripped = bgSentRef.current ? stripQuery(bgSentRef.current) : null;
        const isKnownValid = sentStripped && validBgBufferRef.current.some(u => stripQuery(u) === sentStripped);
        if (bgSentRef.current && !isKnownValid) {
          const expectedBgUrl = currentNp?.bg_image_url || displayedArtUrl;
          if (expectedBgUrl) {
            pushToBgBuffer(validBgBufferRef.current, expectedBgUrl);
            onAlbumArtChangeRef.current?.(expectedBgUrl);
            bgSentRef.current = expectedBgUrl;
          }
        } else if (!bgSentRef.current && displayedArtUrl) {
          const bgUrl = currentNp?.bg_image_url || displayedArtUrl;
          pushToBgBuffer(validBgBufferRef.current, bgUrl);
          onAlbumArtChangeRef.current?.(bgUrl);
          bgSentRef.current = bgUrl;
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
