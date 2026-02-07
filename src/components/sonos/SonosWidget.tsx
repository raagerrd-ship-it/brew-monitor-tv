import { memo, useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSonosTrackTransition } from "./hooks";


interface NowPlaying {
  track_name: string | null;
  artist_name: string | null;
  album_art_url: string | null;
  next_album_art_url?: string | null;
  duration_ms: number | null;
  position_ms: number | null;
  playback_state: string;
}

interface SonosWidgetProps {
  isMobile?: boolean;
  isTvMode?: boolean;
  onAlbumArtChange?: (url: string | null) => void;
  showDebug?: boolean;
  onRealtimeRef?: React.MutableRefObject<((payload: any) => void) | null>;
}

export const SonosWidget = memo(function SonosWidget({ isMobile = false, isTvMode = false, onAlbumArtChange, showDebug = false, onRealtimeRef }: SonosWidgetProps) {
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [showWidget, setShowWidget] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [localProgress, setLocalProgress] = useState<number | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldScroll, setShouldScroll] = useState(false);
  
  // Use the transition hook for track management
  const { 
    fetchNowPlaying, 
    handleTrackUpdate, 
    handleImageLoad, 
    handleImageError 
  } = useSonosTrackTransition(
    isConnected,
    showWidget,
    { nowPlaying, localProgress, imageLoaded, imageError },
    { setNowPlaying, setLocalProgress, setImageLoaded, setImageError }
  );

  // JS-driven progress ticker (1s interval)
  useEffect(() => {
    if (!nowPlaying?.track_name || nowPlaying.playback_state !== 'PLAYBACK_STATE_PLAYING' || !nowPlaying.duration_ms) return;
    
    const timer = window.setInterval(() => {
      setLocalProgress(prev => {
        if (prev === null) return prev;
        const next = prev + 1000;
        return next > (nowPlaying.duration_ms ?? next) ? nowPlaying.duration_ms! : next;
      });
    }, 1000);
    
    return () => clearInterval(timer);
  }, [nowPlaying?.track_name, nowPlaying?.playback_state, nowPlaying?.duration_ms]);

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

  // Initial fetch from database (one-time, no polling)
  useEffect(() => {
    if (!isConnected || !showWidget) return;
    fetchNowPlaying();
  }, [isConnected, showWidget, fetchNowPlaying]);

  // Wire up realtime callback from consolidated channel
  useEffect(() => {
    if (!onRealtimeRef || !isConnected || !showWidget) return;
    onRealtimeRef.current = (payload: any) => {
      if (payload.new) {
        handleTrackUpdate(payload.new as NowPlaying);
      }
    };
    return () => { if (onRealtimeRef) onRealtimeRef.current = null; };
  }, [onRealtimeRef, isConnected, showWidget, handleTrackUpdate]);

  // Notify parent about album art changes
  const onAlbumArtChangeRef = useRef(onAlbumArtChange);
  onAlbumArtChangeRef.current = onAlbumArtChange;
  useEffect(() => {
    const callback = onAlbumArtChangeRef.current;
    if (callback && nowPlaying?.album_art_url && imageLoaded && !imageError) {
      callback(nowPlaying.album_art_url);
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

  // Calculate progress percentage
  const progressPercent = (localProgress && nowPlaying.duration_ms) 
    ? Math.min((localProgress / nowPlaying.duration_ms) * 100, 100)
    : 0;

  // Fixed pixel sizes for scaled container
  const trackFontSize = isTvMode ? '18px' : isMobile ? '0.8rem' : '14px';
  const artistFontSize = isTvMode ? '14px' : isMobile ? '0.7rem' : '12px';
  const progressHeight = isTvMode ? '5px' : isMobile ? '2px' : '3px';
  const widgetHeight = isTvMode ? '130px' : isMobile ? '56px' : '70px';
  const widgetWidth = isTvMode ? '280px' : isMobile ? '140px' : '200px';

  const hasAlbumArt = nowPlaying.album_art_url && imageLoaded && !imageError;

  return (
    <>
      <div 
        className={`relative overflow-hidden rounded-xl ${isTvMode ? '' : 'animate-fade-in'}`}
        style={{
          width: widgetWidth,
          height: widgetHeight,
          contain: 'strict',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 20px 50px -10px rgba(0, 0, 0, 0.25)',
          border: isTvMode ? '1px solid rgba(255, 255, 255, 0.15)' : 'none',
        }}
      >
        {/* Fallback gradient background */}
        <div 
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(135deg, hsl(var(--primary) / 0.9) 0%, hsl(var(--primary) / 0.7) 100%)',
          }}
        />

        {/* Album art background (fades in when loaded) */}
        {nowPlaying.album_art_url && !imageError && (
          <img
            src={nowPlaying.album_art_url}
            alt=""
            decoding="async"
            fetchPriority="high"
            className="absolute inset-0 w-full h-full object-cover"
            style={{ 
              opacity: imageLoaded ? 1 : 0,
              ...(isTvMode ? {} : { transition: 'opacity 600ms ease-out', willChange: imageLoaded ? 'auto' : 'opacity' }),
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
              className={`truncate text-white/80 drop-shadow-md`}
              style={{ fontSize: artistFontSize }}
            >
              {nowPlaying.artist_name}
            </div>
          )}
          
          {/* Progress Bar - JS driven */}
          {nowPlaying.duration_ms && (
            <div 
              className={`w-full rounded-full overflow-hidden ${isTvMode ? 'mt-3' : 'mt-2'}`}
              style={{
                height: progressHeight,
                background: 'rgba(255, 255, 255, 0.2)',
              }}
            >
              <div 
                className="h-full rounded-full"
                style={{
                  width: `${progressPercent}%`,
                  background: 'rgba(255, 255, 255, 0.9)',
                  ...(isTvMode ? {} : { transition: 'width 300ms linear' }),
                }}
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
});