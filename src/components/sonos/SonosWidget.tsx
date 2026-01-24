import { memo, useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

interface NowPlaying {
  track_name: string | null;
  artist_name: string | null;
  album_art_url: string | null;
  duration_ms: number | null;
  position_ms: number | null;
  playback_state: string;
}

interface SonosWidgetProps {
  isMobile?: boolean;
  isTvMode?: boolean;
  onAlbumArtChange?: (url: string | null) => void;
}

export const SonosWidget = memo(function SonosWidget({ isMobile = false, isTvMode = false, onAlbumArtChange }: SonosWidgetProps) {
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [showWidget, setShowWidget] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [localProgress, setLocalProgress] = useState<number | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [previousAlbumArt, setPreviousAlbumArt] = useState<string | null>(null);
  const [showPreviousArt, setShowPreviousArt] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldScroll, setShouldScroll] = useState(false);
  const pollIntervalRef = useRef<number | null>(null);
  const progressIntervalRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(Date.now());
  const trackEndFetchedRef = useRef<boolean>(false);
  const currentTrackRef = useRef<string | null>(null);
  const preloadedImageRef = useRef<HTMLImageElement | null>(null);
  const preloadedDataRef = useRef<NowPlaying | null>(null);
  const currentAlbumArtRef = useRef<string | null>(null);

  // Check if connected and fetch initial data
  useEffect(() => {
    console.log('[Sonos Debug] Checking connection...');
    const checkConnection = async () => {
      try {
        const { data: settings, error: settingsError } = await (supabase as any)
          .from('sonos_settings')
          .select('show_on_dashboard, selected_group_id')
          .limit(1)
          .maybeSingle();

        console.log('[Sonos Debug] Settings loaded:', settings?.selected_group_id ? 'connected' : 'not connected');

        if (settingsError || !settings?.selected_group_id) {
          setIsConnected(false);
          return;
        }

        setIsConnected(true);
        setShowWidget(settings?.show_on_dashboard ?? true);
      } catch (error) {
        console.error('[Sonos Debug] Failed to check Sonos connection:', error);
        setIsConnected(false);
      }
    };

    checkConnection();
  }, []);

  // Poll for now playing data
  useEffect(() => {
    if (!isConnected || !showWidget) return;
    console.log('[Sonos Debug] Starting polling...');

    const fetchNowPlaying = async () => {
      console.log('[Sonos Debug] Fetching now playing...');
      try {
        const response = await supabase.functions.invoke('sonos-now-playing');
        console.log('[Sonos Debug] Got response:', response.data?.track_name || 'no track');
        if (response.data && !response.error) {
          // Reset track end flag when track changes
          if (response.data.track_name !== currentTrackRef.current) {
            trackEndFetchedRef.current = false;
            currentTrackRef.current = response.data.track_name;
            // Check if we pre-loaded this image
            if (preloadedDataRef.current?.album_art_url === response.data.album_art_url && preloadedImageRef.current?.complete) {
              console.log('[Sonos Debug] Using pre-loaded image!');
              setImageLoaded(true);
              setImageError(false);
            } else {
              // Reset image state for new track
              setImageLoaded(false);
              setImageError(false);
            }
            // Clear preload refs
            preloadedImageRef.current = null;
            preloadedDataRef.current = null;
          }
          setNowPlaying(response.data);
          setLocalProgress(response.data.position_ms);
          lastUpdateRef.current = Date.now();
        }
      } catch (error) {
        console.error('[Sonos Debug] Failed to fetch now playing:', error);
      }
    };

    // Initial fetch
    fetchNowPlaying();

    // Poll every 10 seconds when visible
    const startPolling = () => {
      if (pollIntervalRef.current) return;
      pollIntervalRef.current = window.setInterval(fetchNowPlaying, 10000);
    };

    const stopPolling = () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };

    // Handle visibility changes
    const handleVisibility = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        fetchNowPlaying();
        startPolling();
      }
    };

    startPolling();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isConnected, showWidget]);

  // Subscribe to realtime updates
  useEffect(() => {
    if (!isConnected || !showWidget) return;

    const channel = supabase
      .channel('sonos-now-playing')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sonos_now_playing' },
        (payload) => {
        if (payload.new) {
          const newData = payload.new as NowPlaying;
          // Reset track end flag when track changes via realtime
          if (newData.track_name !== currentTrackRef.current) {
            trackEndFetchedRef.current = false;
            currentTrackRef.current = newData.track_name;
            // Check if we pre-loaded this image
            if (preloadedDataRef.current?.album_art_url === newData.album_art_url && preloadedImageRef.current?.complete) {
              console.log('[Sonos Debug] Using pre-loaded image (realtime)!');
              setImageLoaded(true);
              setImageError(false);
            } else {
              // Reset image state for new track
              setImageLoaded(false);
              setImageError(false);
            }
            // Clear preload refs
            preloadedImageRef.current = null;
            preloadedDataRef.current = null;
          }
          setNowPlaying(newData);
          setLocalProgress(newData.position_ms);
          lastUpdateRef.current = Date.now();
        }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isConnected, showWidget]);

  // Notify parent about album art changes - use ref to avoid dependency issues
  const onAlbumArtChangeRef = useRef(onAlbumArtChange);
  onAlbumArtChangeRef.current = onAlbumArtChange;

  useEffect(() => {
    console.log('[Sonos Debug] Album art effect:', { 
      url: nowPlaying?.album_art_url ? 'exists' : 'null', 
      imageLoaded, 
      imageError 
    });
    const callback = onAlbumArtChangeRef.current;
    if (callback) {
      if (nowPlaying?.album_art_url && imageLoaded && !imageError) {
        console.log('[Sonos Debug] Notifying parent: album art loaded');
        callback(nowPlaying.album_art_url);
      } else {
        console.log('[Sonos Debug] Notifying parent: no album art');
        callback(null);
      }
    }
  }, [nowPlaying?.album_art_url, imageLoaded, imageError]);

  // Local progress interpolation + smart track-end detection
  useEffect(() => {
    if (!isConnected || !showWidget) return;
    if (!nowPlaying || nowPlaying.playback_state !== 'PLAYBACK_STATE_PLAYING') {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      return;
    }

    const fetchNowPlaying = async () => {
      try {
        const response = await supabase.functions.invoke('sonos-now-playing');
        if (response.data && !response.error) {
          if (response.data.track_name !== currentTrackRef.current) {
            trackEndFetchedRef.current = false;
            currentTrackRef.current = response.data.track_name;
            setImageLoaded(false);
            setImageError(false);
          }
          setNowPlaying(response.data);
          setLocalProgress(response.data.position_ms);
          lastUpdateRef.current = Date.now();
        }
      } catch (error) {
        console.error('Failed to fetch now playing:', error);
      }
    };

    // Pre-load next track's data 10 seconds before track ends for more buffer time
    const preloadNextTrack = async () => {
      console.log('[Sonos Debug] Pre-loading next track data...');
      try {
        const response = await supabase.functions.invoke('sonos-now-playing', {
          body: { peek_next: true }
        });
        // Store full next track data
        if (response.data?.track_name && response.data.track_name !== nowPlaying.track_name) {
          preloadedDataRef.current = response.data;
          // Preload the image with callback to track completion
          if (response.data.album_art_url) {
            const img = new Image();
            img.onload = () => {
              console.log('[Sonos Debug] Pre-loaded image ready!');
            };
            img.src = response.data.album_art_url;
            preloadedImageRef.current = img;
          }
          console.log('[Sonos Debug] Pre-loaded next track:', response.data.track_name);
        }
      } catch (error) {
        console.error('[Sonos Debug] Failed to preload next track:', error);
      }
    };

    // Apply pre-loaded data immediately when track ends
    const applyPreloadedData = () => {
      if (preloadedDataRef.current) {
        console.log('[Sonos Debug] Applying pre-loaded data immediately!');
        const preloadedData = preloadedDataRef.current;
        currentTrackRef.current = preloadedData.track_name;
        
        // Start crossfade: save current art as previous
        if (currentAlbumArtRef.current && currentAlbumArtRef.current !== preloadedData.album_art_url) {
          setPreviousAlbumArt(currentAlbumArtRef.current);
          setShowPreviousArt(true);
        }
        currentAlbumArtRef.current = preloadedData.album_art_url;
        
        // If image is pre-loaded, mark as loaded immediately to prevent flash
        const imageIsReady = preloadedImageRef.current?.complete && preloadedImageRef.current?.naturalWidth > 0;
        if (imageIsReady) {
          console.log('[Sonos Debug] Image already cached, setting loaded immediately');
          setImageLoaded(true);
          setImageError(false);
          // Fade out previous after a short delay
          setTimeout(() => setShowPreviousArt(false), 800);
        } else {
          console.log('[Sonos Debug] Image not ready yet, will load on display');
          setImageLoaded(false);
          setImageError(false);
        }
        
        // Update state synchronously
        setNowPlaying(preloadedData);
        setLocalProgress(preloadedData.position_ms ?? 0);
        lastUpdateRef.current = Date.now();
        
        // Keep refs for the image onLoad handler to use, clear after short delay
        setTimeout(() => {
          preloadedDataRef.current = null;
          preloadedImageRef.current = null;
        }, 100);
        
        // Still fetch to verify/update, but don't block UI
        setTimeout(fetchNowPlaying, 1500);
        return true;
      }
      return false;
    };

    progressIntervalRef.current = window.setInterval(() => {
      setLocalProgress((prev) => {
        if (prev === null || !nowPlaying.duration_ms) return prev;
        const elapsed = Date.now() - lastUpdateRef.current;
        const newProgress = (nowPlaying.position_ms ?? 0) + elapsed;
        const remaining = nowPlaying.duration_ms - newProgress;
        
        // Pre-load next track's data 10 seconds before track ends for more buffer time
        if (remaining <= 10000 && remaining > 9000 && !trackEndFetchedRef.current) {
          preloadNextTrack();
        }
        
        // When track ends, immediately apply pre-loaded data
        if (remaining <= 500 && remaining > -500 && !trackEndFetchedRef.current) {
          trackEndFetchedRef.current = true;
          // Try to apply preloaded data immediately
          if (!applyPreloadedData()) {
            // Fallback: fetch if no preloaded data
            fetchNowPlaying();
          }
        }
        
        return Math.min(newProgress, nowPlaying.duration_ms);
      });
    }, 1000);

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    };
  }, [isConnected, showWidget, nowPlaying]);

  // Check if text needs scrolling (marquee)
  useEffect(() => {
    if (!textRef.current || !containerRef.current) return;

    const checkScroll = () => {
      if (textRef.current && containerRef.current) {
        setShouldScroll(textRef.current.scrollWidth > containerRef.current.clientWidth);
      }
    };

    checkScroll();
    window.addEventListener('resize', checkScroll);
    return () => window.removeEventListener('resize', checkScroll);
  }, [nowPlaying]);

  // Don't render if not connected, not visible, or nothing playing
  if (!isConnected || !showWidget) return null;
  if (!nowPlaying?.track_name) return null;
  if (nowPlaying.playback_state !== 'PLAYBACK_STATE_PLAYING') return null;

  // Calculate progress percentage
  const progressPercent = (localProgress && nowPlaying.duration_ms) 
    ? Math.min((localProgress / nowPlaying.duration_ms) * 100, 100)
    : 0;

  // Size configuration based on mode
  const trackFontSize = isTvMode ? 'min(3.5vh, 1.4rem)' : isMobile ? '0.8rem' : 'min(2vh, 0.9rem)';
  const artistFontSize = isTvMode ? 'min(2.5vh, 1rem)' : isMobile ? '0.7rem' : 'min(1.6vh, 0.75rem)';
  const progressHeight = isTvMode ? 'min(0.6vh, 5px)' : isMobile ? '2px' : 'min(0.4vh, 3px)';
  const widgetHeight = isTvMode ? 'min(14vh, 140px)' : isMobile ? '56px' : 'min(7vh, 70px)';
  const widgetWidth = isTvMode ? 'min(26vw, 280px)' : isMobile ? '140px' : 'min(18vw, 200px)';

  const hasAlbumArt = nowPlaying.album_art_url && imageLoaded && !imageError;

  return (
    <div 
      className="relative overflow-hidden rounded-xl transition-all duration-300 animate-fade-in"
      style={{
        width: widgetWidth,
        height: widgetHeight,
        boxShadow: isTvMode 
          ? '0 25px 50px -12px rgba(0, 0, 0, 0.6), 0 12px 24px -8px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1)'
          : '0 10px 25px -5px rgba(0, 0, 0, 0.3)',
      }}
    >
      {/* Fallback gradient background */}
      <div 
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(135deg, hsl(var(--primary) / 0.9) 0%, hsl(var(--primary) / 0.7) 100%)',
        }}
      />

      {/* Previous album art for crossfade (underneath) */}
      {previousAlbumArt && showPreviousArt && (
        <img
          src={previousAlbumArt}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          style={{ opacity: 1 }}
        />
      )}

      {/* Current album art background (on top, fades in) */}
      {nowPlaying.album_art_url && !imageError && (
        <img
          src={nowPlaying.album_art_url}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          style={{ 
            opacity: imageLoaded ? 1 : 0,
            transition: 'opacity 800ms ease-out',
          }}
          onLoad={() => {
            setImageLoaded(true);
            currentAlbumArtRef.current = nowPlaying.album_art_url;
            // Fade out previous art after new one is loaded
            setTimeout(() => setShowPreviousArt(false), 800);
          }}
          onError={() => setImageError(true)}
        />
      )}

      {/* Dark overlay for readability */}
      {hasAlbumArt && (
        <div 
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(135deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.3) 100%)',
          }}
        />
      )}
      
      {/* Content */}
      <div 
        className={`relative h-full flex flex-col justify-center ${
          isTvMode ? 'px-5 py-3' : isMobile ? 'px-3 py-2' : 'px-4 py-2'
        }`}
      >
        <div 
          ref={containerRef}
          className="overflow-hidden"
        >
          <div 
            ref={textRef}
            className={`whitespace-nowrap font-semibold text-white drop-shadow-lg ${
              shouldScroll && !isTvMode ? 'animate-marquee' : ''
            }`}
            style={{ fontSize: trackFontSize }}
          >
            {nowPlaying.track_name}
          </div>
        </div>
        {nowPlaying.artist_name && (
          <div 
            className="truncate text-white/80 drop-shadow-md"
            style={{ fontSize: artistFontSize }}
          >
            {nowPlaying.artist_name}
          </div>
        )}
        
        {/* Progress Bar */}
        {nowPlaying.duration_ms && (
          <div 
            className={`w-full rounded-full overflow-hidden ${isTvMode ? 'mt-3' : 'mt-2'}`}
            style={{
              height: progressHeight,
              background: 'rgba(255, 255, 255, 0.2)',
            }}
          >
            <div 
              className="h-full rounded-full transition-[width] duration-1000 ease-linear"
              style={{
                width: `${progressPercent}%`,
                background: 'rgba(255, 255, 255, 0.9)',
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
});