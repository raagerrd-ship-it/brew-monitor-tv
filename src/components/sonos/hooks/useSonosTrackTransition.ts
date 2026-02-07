import React, { useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface NowPlaying {
  track_name: string | null;
  artist_name: string | null;
  album_art_url: string | null;
  next_album_art_url?: string | null;
  duration_ms: number | null;
  position_ms: number | null;
  playback_state: string;
}

interface TrackTransitionState {
  nowPlaying: NowPlaying | null;
  localProgress: number | null;
  imageLoaded: boolean;
  imageError: boolean;
}

interface TrackTransitionActions {
  setNowPlaying: (data: NowPlaying | null) => void;
  setLocalProgress: React.Dispatch<React.SetStateAction<number | null>>;
  setImageLoaded: (loaded: boolean) => void;
  setImageError: (error: boolean) => void;
}

/**
 * Hook that manages track transitions and progress for the Sonos widget.
 * Simplified: no crossfade, no preloading - just fetch and update.
 */
export function useSonosTrackTransition(
  isConnected: boolean,
  showWidget: boolean,
  state: TrackTransitionState,
  actions: TrackTransitionActions
) {
  const { nowPlaying } = state;
  const { setNowPlaying, setLocalProgress, setImageLoaded, setImageError } = actions;

  const currentTrackRef = useRef<string | null>(null);
  const lastUpdateRef = useRef<number>(Date.now());
  const nowPlayingRef = useRef(nowPlaying);
  const isFetchingRef = useRef(false);
  
  nowPlayingRef.current = nowPlaying;

  // Fetch now playing data from database (not edge function)
  const fetchNowPlaying = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    
    try {
      const { data, error } = await (supabase as any)
        .from('sonos_now_playing')
        .select('track_name, artist_name, album_art_url, next_album_art_url, duration_ms, position_ms, playback_state')
        .limit(1)
        .maybeSingle();
      
      if (data && !error) {
        const isNewTrack = data.track_name !== currentTrackRef.current;
        if (isNewTrack) {
          currentTrackRef.current = data.track_name;
          setImageError(false);
        }
        setNowPlaying(data);
        setLocalProgress(data.position_ms);
        lastUpdateRef.current = Date.now();
      }
    } catch (error) {
      console.error('[Sonos] Failed to fetch from DB:', error);
    } finally {
      isFetchingRef.current = false;
    }
  }, [setNowPlaying, setLocalProgress, setImageError]);

  // Handle track change from realtime
  const handleTrackUpdate = useCallback((newData: NowPlaying) => {
    if (newData.track_name !== currentTrackRef.current) {
      currentTrackRef.current = newData.track_name;
      // Don't reset imageLoaded - keep old image visible until new loads
      setImageError(false);
    }
    setNowPlaying(newData);
    setLocalProgress(newData.position_ms);
    lastUpdateRef.current = Date.now();
  }, [setNowPlaying, setLocalProgress, setImageError]);

  const handleImageLoad = useCallback(() => {
    setImageLoaded(true);
  }, [setImageLoaded]);

  const handleImageError = useCallback(() => {
    setImageError(true);
  }, [setImageError]);

  return {
    fetchNowPlaying,
    handleTrackUpdate,
    handleImageLoad,
    handleImageError,
    lastUpdateRef,
  };
}