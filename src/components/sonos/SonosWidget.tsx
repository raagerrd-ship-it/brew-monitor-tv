import { memo, useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSonosTrackTransition } from "./hooks";
import { SonosDebugOverlay } from "./SonosDebugOverlay";

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
  showDebug?: boolean;
}

export const SonosWidget = memo(function SonosWidget({ isMobile = false, isTvMode = false, onAlbumArtChange, showDebug = false }: SonosWidgetProps) {
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

  // Use the transition hook for track management
  const { 
    fetchNowPlaying, 
    handleTrackUpdate, 
    handleImageLoad, 
    handleImageError 
  } = useSonosTrackTransition(
    isConnected,
    showWidget,
    { nowPlaying, localProgress, imageLoaded, imageError, previousAlbumArt, showPreviousArt },
    { setNowPlaying, setLocalProgress, setImageLoaded, setImageError, setPreviousAlbumArt, setShowPreviousArt }
  );

  // Check if connected and fetch initial data
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const { data: settings, error: settingsError } = await (supabase as any)
          .from('sonos_settings')
          .select('show_on_dashboard, selected_group_id')
          .limit(1)
          .maybeSingle();

        if (settingsError || !settings?.selected_group_id) {
          setIsConnected(false);
          return;
        }

        setIsConnected(true);
        setShowWidget(settings?.show_on_dashboard ?? true);
      } catch (error) {
        console.error('[Sonos] Failed to check connection:', error);
        setIsConnected(false);
      }
    };

    checkConnection();
  }, []);

  // Single polling interval - 30s for progress sync, realtime handles track changes
  useEffect(() => {
    if (!isConnected || !showWidget) return;

    // Initial fetch
    fetchNowPlaying();

    // Sync progress every 30 seconds to correct CSS drift
    const SYNC_INTERVAL = 30000;
    pollIntervalRef.current = window.setInterval(fetchNowPlaying, SYNC_INTERVAL);

    // Handle visibility changes
    const handleVisibility = () => {
      if (document.hidden) {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      } else {
        fetchNowPlaying();
        if (!pollIntervalRef.current) {
          pollIntervalRef.current = window.setInterval(fetchNowPlaying, SYNC_INTERVAL);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isConnected, showWidget, fetchNowPlaying]);

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
            handleTrackUpdate(payload.new as NowPlaying);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isConnected, showWidget, handleTrackUpdate]);

  // Notify parent about album art changes
  const onAlbumArtChangeRef = useRef(onAlbumArtChange);
  onAlbumArtChangeRef.current = onAlbumArtChange;

  useEffect(() => {
    const callback = onAlbumArtChangeRef.current;
    if (callback) {
      if (nowPlaying?.album_art_url && imageLoaded && !imageError) {
        callback(nowPlaying.album_art_url);
      } else {
        callback(null);
      }
    }
  }, [nowPlaying?.album_art_url, imageLoaded, imageError]);

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

  // Calculate progress for CSS animation
  const initialProgress = (localProgress && nowPlaying.duration_ms) 
    ? Math.min((localProgress / nowPlaying.duration_ms) * 100, 100)
    : 0;
  const remainingMs = nowPlaying.duration_ms 
    ? Math.max(0, nowPlaying.duration_ms - (localProgress ?? 0))
    : 0;

  // Fixed pixel sizes for scaled container
  const trackFontSize = isTvMode ? '26px' : isMobile ? '0.8rem' : '14px';
  const artistFontSize = isTvMode ? '18px' : isMobile ? '0.7rem' : '12px';
  const progressHeight = isTvMode ? '6px' : isMobile ? '2px' : '3px';
  const widgetHeight = isTvMode ? '170px' : isMobile ? '56px' : '70px';
  const widgetWidth = isTvMode ? '340px' : isMobile ? '140px' : '200px';

  const hasAlbumArt = nowPlaying.album_art_url && imageLoaded && !imageError;

  return (
    <>
      {showDebug && (
        <SonosDebugOverlay
          trackName={nowPlaying.track_name}
          artistName={nowPlaying.artist_name}
          playbackState={nowPlaying.playback_state}
          positionMs={localProgress}
          durationMs={nowPlaying.duration_ms}
          imageLoaded={imageLoaded}
          imageError={imageError}
        />
      )}
      <div 
        className="relative overflow-hidden rounded-xl animate-fade-in"
      style={{
        width: widgetWidth,
        height: widgetHeight,
        contain: 'strict', // Isolate rendering for performance
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
          decoding="async"
          className="absolute inset-0 w-full h-full object-cover"
          style={{ 
            opacity: 1,
            willChange: 'opacity',
          }}
        />
      )}

      {/* Current album art background (on top, fades in) */}
      {nowPlaying.album_art_url && !imageError && (
        <img
          src={nowPlaying.album_art_url}
          alt=""
          decoding="async"
          fetchPriority="high"
          className="absolute inset-0 w-full h-full object-cover"
          style={{ 
            opacity: imageLoaded ? 1 : 0,
            transition: 'opacity 600ms ease-out',
            willChange: imageLoaded ? 'auto' : 'opacity',
          }}
          onLoad={handleImageLoad}
          onError={handleImageError}
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
        
        {/* Progress Bar - CSS animated, no JS updates */}
        {nowPlaying.duration_ms && (
          <div 
            className={`w-full rounded-full overflow-hidden ${isTvMode ? 'mt-3' : 'mt-2'}`}
            style={{
              height: progressHeight,
              background: 'rgba(255, 255, 255, 0.2)',
            }}
          >
            <div 
              key={`${nowPlaying.track_name}-${localProgress}`}
              className="h-full rounded-full"
              style={{
                '--progress-start': `${initialProgress}%`,
                width: `${initialProgress}%`,
                background: 'rgba(255, 255, 255, 0.9)',
                animation: remainingMs > 0 ? `progress-grow ${remainingMs}ms linear forwards` : 'none',
              } as React.CSSProperties}
            />
          </div>
        )}
      </div>
      </div>
    </>
  );
});
