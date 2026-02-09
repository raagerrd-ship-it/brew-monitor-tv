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
  trackChangedAtRef: React.MutableRefObject<number>;
  bgSentRef: React.MutableRefObject<string | null>;
  validBgBufferRef: React.MutableRefObject<string[]>;
  onAlbumArtChangeRef: React.MutableRefObject<((url: string | null) => void) | undefined>;
  trackChangeOffsetRef: React.MutableRefObject<number>;
  progressBarRef: React.RefObject<HTMLDivElement | null>;
  debugTimeRef: React.RefObject<HTMLSpanElement | null>;
  addDebugLog?: (event: string) => void;
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
    localProgressRef, lastPredictivePollRef, trackChangedAtRef, trackChangeOffsetRef,
    bgSentRef, validBgBufferRef, onAlbumArtChangeRef,
    progressBarRef, debugTimeRef, addDebugLog,
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
          const currentNpSnap = nowPlayingRef.current;
          const trackChanged = (currentNpSnap?.track_name ?? nowPlaying.track_name) !== data.trackName;
          if (trackChanged) {
            addDebugLog?.(`📡 Poll: track changed → ${data.trackName}`);
            handleTrackChange(data, false);
          } else {
            // Same track — update metadata, state, and art URLs if changed
            // BUT skip art URL updates during cooldown to prevent stale DB data overwriting early-swapped images
            const msSinceTrackChange = Date.now() - trackChangedAtRef.current;
            // Cooldown scales with track change offset setting (minimum 15s)
            const cooldownMs = Math.max(15000, trackChangeOffsetRef.current * 1000 + 15000);
            const inCooldown = msSinceTrackChange < cooldownMs;

            setNowPlaying(prev => {
              if (!prev) return prev;
              const artistChanged = prev.artist_name !== data.artistName;
              const albumChanged = prev.album_name !== data.albumName;
              const stateChanged = prev.playback_state !== data.playbackState;
              const durationChanged = duration && prev.duration_ms !== duration;

              // During cooldown, don't accept art URLs from DB — they may be stale
              const bgChanged = !inCooldown && data.bgImageUrl && data.bgImageUrl !== prev.bg_image_url;
              const widgetChanged = !inCooldown && data.widgetArtUrl && data.widgetArtUrl !== prev.widget_art_url;
              const artChanged = !inCooldown && data.albumArtUrl && data.albumArtUrl !== prev.album_art_url;
              const nextBgChanged = !inCooldown && data.nextBgImageUrl !== undefined && data.nextBgImageUrl !== prev.next_bg_image_url;
              const nextWidgetChanged = !inCooldown && data.nextWidgetArtUrl !== undefined && data.nextWidgetArtUrl !== prev.next_widget_art_url;
              const nextTrackChanged = !inCooldown && data.nextTrackName !== undefined && data.nextTrackName !== prev.next_track_name;
              const nextArtistChanged = !inCooldown && data.nextArtistName !== undefined && data.nextArtistName !== prev.next_artist_name;
              
              // Log next-track data when it arrives
              if (nextTrackChanged && data.nextTrackName) {
                addDebugLog?.(`📡 Poll: next track → ${data.nextTrackName} (${data.nextArtistName || '?'})`);
              }
              if (nextBgChanged && data.nextBgImageUrl) {
                addDebugLog?.(`📡 Poll: next BG URL received`);
              }
              if (nextWidgetChanged && data.nextWidgetArtUrl) {
                addDebugLog?.(`📡 Poll: next widget art received`);
              }
              if (!artistChanged && !albumChanged && !stateChanged && !durationChanged && !bgChanged && !widgetChanged && !artChanged && !nextBgChanged && !nextWidgetChanged && !nextTrackChanged && !nextArtistChanged) return prev;

              if (inCooldown) {
                console.log(`[Sonos:BG] Poll: skipping art URLs during cooldown (${Math.round(msSinceTrackChange / 1000)}s)`);
              }

              // Push new bg to buffer if changed
              if (bgChanged && data.bgImageUrl) {
                pushToBgBuffer(validBgBufferRef.current, data.bgImageUrl);
                onAlbumArtChangeRef.current?.(data.bgImageUrl);
                bgSentRef.current = data.bgImageUrl;
              }

              return {
                ...prev,
                artist_name: data.artistName ?? prev.artist_name,
                album_name: data.albumName ?? prev.album_name,
                playback_state: data.playbackState,
                position_ms: data.positionMillis,
                duration_ms: duration ?? prev.duration_ms,
                ...(bgChanged ? { bg_image_url: data.bgImageUrl } : {}),
                ...(nextBgChanged ? { next_bg_image_url: data.nextBgImageUrl } : {}),
                ...(widgetChanged ? { widget_art_url: data.widgetArtUrl } : {}),
                ...(nextWidgetChanged ? { next_widget_art_url: data.nextWidgetArtUrl } : {}),
                ...(artChanged ? { album_art_url: data.albumArtUrl } : {}),
                ...(nextTrackChanged ? { next_track_name: data.nextTrackName } : {}),
                ...(nextArtistChanged ? { next_artist_name: data.nextArtistName } : {}),
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
