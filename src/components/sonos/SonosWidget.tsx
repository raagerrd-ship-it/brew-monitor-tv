import { memo, useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSonosTrackTransition } from "./hooks";
import { SonosDebugOverlay } from "./SonosDebugOverlay";

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
  onBackgroundUrlChange?: (url: string | null) => void;
  showDebug?: boolean;
}

export const SonosWidget = memo(function SonosWidget({ isMobile = false, isTvMode = false, onAlbumArtChange, onBackgroundUrlChange, showDebug = false }: SonosWidgetProps) {
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [showWidget, setShowWidget] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [localProgress, setLocalProgress] = useState<number | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldScroll, setShouldScroll] = useState(false);
  const pollIntervalRef = useRef<number | null>(null);
  const lastBgRequestRef = useRef<string | null>(null);
  const preloadedNextBgRef = useRef<{ artUrl: string; bgUrl: string } | null>(null);
  const isPreloadingNextRef = useRef(false);
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

  // Polling interval - 5s for track changes
  useEffect(() => {
    if (!isConnected || !showWidget) return;

    fetchNowPlaying();

    const SYNC_INTERVAL = 5000;
    pollIntervalRef.current = window.setInterval(fetchNowPlaying, SYNC_INTERVAL);

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
  const onBackgroundUrlChangeRef = useRef(onBackgroundUrlChange);
  onBackgroundUrlChangeRef.current = onBackgroundUrlChange;

  useEffect(() => {
    const callback = onAlbumArtChangeRef.current;
    if (callback && nowPlaying?.album_art_url && imageLoaded && !imageError) {
      // Only notify parent with a valid URL, never with null
      // This prevents the background from disappearing between tracks
      callback(nowPlaying.album_art_url);
    }
  }, [nowPlaying?.album_art_url, imageLoaded, imageError]);

  // Request pre-processed background image from edge function when track changes
  // Check preloaded ref first for instant swap, otherwise reactive fallback
  useEffect(() => {
    const bgCallback = onBackgroundUrlChangeRef.current;
    if (!bgCallback || !nowPlaying?.album_art_url) return;

    // Only request if this is a new album art URL
    if (nowPlaying.album_art_url === lastBgRequestRef.current) return;
    lastBgRequestRef.current = nowPlaying.album_art_url;

    // Check if we already preloaded this background
    if (preloadedNextBgRef.current?.artUrl === nowPlaying.album_art_url) {
      console.log('[Sonos] Using preloaded background - instant swap');
      bgCallback(preloadedNextBgRef.current.bgUrl);
      preloadedNextBgRef.current = null;
      return;
    }

    // Fallback: reactive processing (old background stays visible until ready)
    const controller = new AbortController();
    
    (async () => {
      try {
        const response = await Promise.race([
          supabase.functions.invoke('prepare-album-background', {
            body: { imageUrl: nowPlaying.album_art_url },
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), 10000)
          ),
        ]);

        if (!controller.signal.aborted && response.data?.backgroundUrl) {
          const img = new Image();
          img.onload = () => {
            if (!controller.signal.aborted) {
              bgCallback(response.data.backgroundUrl);
            }
          };
          img.onerror = () => {
            console.warn('[Sonos] Background image preload failed');
          };
          img.src = response.data.backgroundUrl;
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn('[Sonos] Background preparation failed:', error);
        }
      }
    })();

    return () => { controller.abort(); };
  }, [nowPlaying?.album_art_url]);

  // Predictive preloading: prepare next track's background 15s before song ends
  useEffect(() => {
    if (!nowPlaying?.next_album_art_url || !nowPlaying.duration_ms || localProgress === null) return;
    
    const timeLeft = nowPlaying.duration_ms - localProgress;
    // Only trigger between 15s and 3s remaining, and not if already preloading
    if (timeLeft > 15000 || timeLeft < 3000 || isPreloadingNextRef.current) return;
    // Don't preload if it matches the current track's art
    if (nowPlaying.next_album_art_url === nowPlaying.album_art_url) return;
    // Don't preload if we already have this one cached
    if (preloadedNextBgRef.current?.artUrl === nowPlaying.next_album_art_url) return;

    isPreloadingNextRef.current = true;
    const nextArtUrl = nowPlaying.next_album_art_url;
    console.log('[Sonos] Predictive preloading background for next track');

    (async () => {
      try {
        const response = await Promise.race([
          supabase.functions.invoke('prepare-album-background', {
            body: { imageUrl: nextArtUrl },
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), 12000)
          ),
        ]);

        if (response.data?.backgroundUrl) {
          // Preload into browser cache
          const img = new Image();
          img.onload = () => {
            preloadedNextBgRef.current = { artUrl: nextArtUrl, bgUrl: response.data.backgroundUrl };
            isPreloadingNextRef.current = false;
            console.log('[Sonos] Next background preloaded and cached');
          };
          img.onerror = () => {
            isPreloadingNextRef.current = false;
          };
          img.src = response.data.backgroundUrl;
        } else {
          isPreloadingNextRef.current = false;
        }
      } catch (error) {
        console.warn('[Sonos] Predictive preload failed:', error);
        isPreloadingNextRef.current = false;
      }
    })();
  }, [localProgress, nowPlaying?.next_album_art_url, nowPlaying?.duration_ms, nowPlaying?.album_art_url]);

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
  const widgetHeight = isTvMode ? '120px' : isMobile ? '56px' : '70px';
  const widgetWidth = isTvMode ? '240px' : isMobile ? '140px' : '200px';

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
        className={`relative overflow-hidden rounded-xl ${isTvMode ? '' : 'animate-fade-in'}`}
        style={{
          width: widgetWidth,
          height: widgetHeight,
          contain: 'strict',
          boxShadow: isTvMode 
            ? 'none'
            : '0 10px 25px -5px rgba(0, 0, 0, 0.3)',
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
              className={`whitespace-nowrap font-semibold text-white ${isTvMode ? '' : 'drop-shadow-lg'} ${
                shouldScroll && !isTvMode ? 'animate-marquee' : ''
              }`}
              style={{ fontSize: trackFontSize }}
            >
              {nowPlaying.track_name}
            </div>
          </div>
          {nowPlaying.artist_name && (
            <div 
              className={`truncate text-white/80 ${isTvMode ? '' : 'drop-shadow-md'}`}
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