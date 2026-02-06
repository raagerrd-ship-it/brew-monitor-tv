import React, { useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface NowPlaying {
  track_name: string | null;
  artist_name: string | null;
  album_art_url: string | null;
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

  // Fetch now playing data with timeout and concurrency guard
  const fetchNowPlaying = useCallback(async () => {
    if (isFetchingRef.current) {
      console.log('[Sonos] Skipping fetch - previous request still in progress');
      return;
    }
    isFetchingRef.current = true;
    
    try {
      const response = await Promise.race([
        supabase.functions.invoke('sonos-now-playing', { body: {} }),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout: sonos-now-playing took >8s')), 8000)
        )
      ]);
      
      if (response.data && !response.error) {
        const isNewTrack = response.data.track_name !== currentTrackRef.current;
        
        if (isNewTrack) {
          currentTrackRef.current = response.data.track_name;
          // Don't reset imageLoaded/imageError - keep old image visible
          // until the new one loads via onLoad callback
          setImageError(false);
        }
        setNowPlaying(response.data);
        setLocalProgress(response.data.position_ms);
        lastUpdateRef.current = Date.now();
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Timeout')) {
        console.warn('[Sonos]', error.message);
      } else {
        console.error('[Sonos] Failed to fetch now playing:', error);
      }
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