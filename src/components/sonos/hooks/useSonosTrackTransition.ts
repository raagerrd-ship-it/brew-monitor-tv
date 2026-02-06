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
  previousAlbumArt: string | null;
  showPreviousArt: boolean;
}

interface TrackTransitionActions {
  setNowPlaying: (data: NowPlaying | null) => void;
  setLocalProgress: React.Dispatch<React.SetStateAction<number | null>>;
  setImageLoaded: (loaded: boolean) => void;
  setImageError: (error: boolean) => void;
  setPreviousAlbumArt: (url: string | null) => void;
  setShowPreviousArt: (show: boolean) => void;
}

/**
 * Hook that manages track transitions, preloading, and progress interpolation
 * for the Sonos widget. Handles the complex logic of seamless track changes.
 */
export function useSonosTrackTransition(
  isConnected: boolean,
  showWidget: boolean,
  state: TrackTransitionState,
  actions: TrackTransitionActions
) {
  const { nowPlaying, localProgress } = state;
  const { 
    setNowPlaying, 
    setLocalProgress, 
    setImageLoaded, 
    setImageError,
    setPreviousAlbumArt,
    setShowPreviousArt 
  } = actions;

  // Refs for transition management
  const preloadedImageRef = useRef<HTMLImageElement | null>(null);
  const preloadedDataRef = useRef<NowPlaying | null>(null);
  const currentAlbumArtRef = useRef<string | null>(null);
  const currentTrackRef = useRef<string | null>(null);
  const trackEndFetchedRef = useRef<boolean>(false);
  const lastUpdateRef = useRef<number>(Date.now());
  const nowPlayingRef = useRef(nowPlaying);
  const isFetchingRef = useRef(false);
  
  // Keep ref in sync
  nowPlayingRef.current = nowPlaying;

  // Clean up preloaded image to free memory
  const cleanupPreloadedImage = useCallback(() => {
    if (preloadedImageRef.current) {
      preloadedImageRef.current.onload = null;
      preloadedImageRef.current.onerror = null;
      preloadedImageRef.current.src = '';
      preloadedImageRef.current = null;
    }
    preloadedDataRef.current = null;
  }, []);

  // Fetch now playing data with timeout and concurrency guard
  const fetchNowPlaying = useCallback(async () => {
    // Guard against overlapping requests
    if (isFetchingRef.current) {
      console.log('[Sonos] Skipping fetch - previous request still in progress');
      return;
    }
    isFetchingRef.current = true;
    
    try {
      // Use Promise.race for real timeout since AbortController doesn't work with supabase.functions.invoke
      const response = await Promise.race([
        supabase.functions.invoke('sonos-now-playing', { body: {} }),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout: sonos-now-playing took >8s')), 8000)
        )
      ]);
      
      if (response.data && !response.error) {
        const isNewTrack = response.data.track_name !== currentTrackRef.current;
        
        if (isNewTrack) {
          trackEndFetchedRef.current = false;
          currentTrackRef.current = response.data.track_name;
        }
        
        // Batch all state updates together to minimize re-renders
        // React 18 batches in event handlers but NOT in async callbacks,
        // so we use unstable_batchedUpdates pattern via sequential sets
        // within the same microtask
        if (isNewTrack) {
          setImageLoaded(false);
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
  }, [setNowPlaying, setLocalProgress, setImageLoaded, setImageError]);

  // Pre-load next track's data
  const preloadNextTrack = useCallback(async () => {
    const current = nowPlayingRef.current;
    if (!current) return;
    
    console.log('[Sonos] Pre-loading next track...');
    try {
      const response = await Promise.race([
        supabase.functions.invoke('sonos-now-playing', { body: { peek_next: true } }),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout: preload took >8s')), 8000)
        )
      ]);
      if (response.data?.track_name && response.data.track_name !== current.track_name) {
        cleanupPreloadedImage();
        
        preloadedDataRef.current = response.data;
        if (response.data.album_art_url) {
          const img = new Image();
          img.onload = () => console.log('[Sonos] Pre-loaded image ready');
          img.onerror = () => {
            console.log('[Sonos] Pre-load image failed');
            cleanupPreloadedImage();
          };
          img.src = response.data.album_art_url;
          preloadedImageRef.current = img;
        }
      }
    } catch (error) {
      console.warn('[Sonos] Preload failed (timeout or network):', error instanceof Error ? error.message : error);
    }
  }, [cleanupPreloadedImage]);

  // Apply pre-loaded data immediately when track ends
  const applyPreloadedData = useCallback(() => {
    try {
      if (!preloadedDataRef.current) return false;
      
      console.log('[Sonos] Applying pre-loaded data');
      const preloadedData = preloadedDataRef.current;
      const preloadedImage = preloadedImageRef.current;
      
      // Clear refs first to prevent re-entry
      preloadedDataRef.current = null;
      preloadedImageRef.current = null;
      
      currentTrackRef.current = preloadedData.track_name;
      
      // Handle crossfade
      if (currentAlbumArtRef.current && currentAlbumArtRef.current !== preloadedData.album_art_url) {
        setPreviousAlbumArt(currentAlbumArtRef.current);
        setShowPreviousArt(true);
        setTimeout(() => {
          setPreviousAlbumArt(null);
          setShowPreviousArt(false);
        }, 1000);
      }
      currentAlbumArtRef.current = preloadedData.album_art_url;
      
      const imageIsReady = preloadedImage?.complete && preloadedImage?.naturalWidth > 0;
      
      // Clean up preloaded image reference after use
      if (preloadedImage) {
        preloadedImage.onload = null;
        preloadedImage.onerror = null;
      }
      
      // Batch all state updates
      setImageLoaded(imageIsReady);
      setImageError(false);
      setNowPlaying(preloadedData);
      setLocalProgress(preloadedData.position_ms ?? 0);
      lastUpdateRef.current = Date.now();
      
      // Delayed refetch for accuracy
      setTimeout(() => {
        fetchNowPlaying().catch(console.error);
      }, 1500);
      
      return true;
    } catch (error) {
      console.error('[Sonos] Error applying preloaded data:', error);
      return false;
    }
  }, [setNowPlaying, setLocalProgress, setImageLoaded, setImageError, setPreviousAlbumArt, setShowPreviousArt, fetchNowPlaying]);

  // Handle track change from polling/realtime
  const handleTrackUpdate = useCallback((newData: NowPlaying) => {
    if (newData.track_name !== currentTrackRef.current) {
      trackEndFetchedRef.current = false;
      currentTrackRef.current = newData.track_name;
      
      // Check if we pre-loaded this image
      if (preloadedDataRef.current?.album_art_url === newData.album_art_url && 
          preloadedImageRef.current?.complete) {
        setImageLoaded(true);
        setImageError(false);
      } else {
        setImageLoaded(false);
        setImageError(false);
      }
      cleanupPreloadedImage();
    }
    // Batch remaining state updates
    setNowPlaying(newData);
    setLocalProgress(newData.position_ms);
    lastUpdateRef.current = Date.now();
  }, [setNowPlaying, setLocalProgress, setImageLoaded, setImageError, cleanupPreloadedImage]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupPreloadedImage();
    };
  }, [cleanupPreloadedImage]);

  // Handle image load for current album art
  const handleImageLoad = useCallback(() => {
    setImageLoaded(true);
    currentAlbumArtRef.current = nowPlayingRef.current?.album_art_url ?? null;
    setTimeout(() => setShowPreviousArt(false), 800);
  }, [setImageLoaded, setShowPreviousArt]);

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
