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
}

export const SonosWidget = memo(function SonosWidget({ isMobile = false, isTvMode = false }: SonosWidgetProps) {
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [showWidget, setShowWidget] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [localProgress, setLocalProgress] = useState<number | null>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldScroll, setShouldScroll] = useState(false);
  const pollIntervalRef = useRef<number | null>(null);
  const progressIntervalRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(Date.now());
  const trackEndFetchedRef = useRef<boolean>(false);
  const currentTrackRef = useRef<string | null>(null);

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
        console.error('Failed to check Sonos connection:', error);
        setIsConnected(false);
      }
    };

    checkConnection();
  }, []);

  // Poll for now playing data
  useEffect(() => {
    if (!isConnected || !showWidget) return;

    const fetchNowPlaying = async () => {
      try {
        const response = await supabase.functions.invoke('sonos-now-playing');
        if (response.data && !response.error) {
          // Reset track end flag when track changes
          if (response.data.track_name !== currentTrackRef.current) {
            trackEndFetchedRef.current = false;
            currentTrackRef.current = response.data.track_name;
          }
          setNowPlaying(response.data);
          setLocalProgress(response.data.position_ms);
          lastUpdateRef.current = Date.now();
        }
      } catch (error) {
        console.error('Failed to fetch now playing:', error);
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
          }
          setNowPlaying(response.data);
          setLocalProgress(response.data.position_ms);
          lastUpdateRef.current = Date.now();
        }
      } catch (error) {
        console.error('Failed to fetch now playing:', error);
      }
    };

    progressIntervalRef.current = window.setInterval(() => {
      setLocalProgress((prev) => {
        if (prev === null || !nowPlaying.duration_ms) return prev;
        const elapsed = Date.now() - lastUpdateRef.current;
        const newProgress = (nowPlaying.position_ms ?? 0) + elapsed;
        const remaining = nowPlaying.duration_ms - newProgress;
        
        // Smart track-end detection: fetch 2 seconds before track ends
        if (remaining <= 2000 && remaining > 0 && !trackEndFetchedRef.current) {
          trackEndFetchedRef.current = true;
          // Schedule fetch slightly after track should end
          setTimeout(fetchNowPlaying, remaining + 500);
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

  return (
    <div 
      className="relative overflow-hidden rounded-xl transition-all duration-300 animate-fade-in backdrop-blur-md"
      style={{
        width: widgetWidth,
        height: widgetHeight,
        background: 'rgba(0, 0, 0, 0.4)',
        boxShadow: isTvMode 
          ? '0 25px 50px -12px rgba(0, 0, 0, 0.6), 0 12px 24px -8px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1)'
          : '0 10px 25px -5px rgba(0, 0, 0, 0.3)',
      }}
    >
      {/* Album Art Background */}
      {nowPlaying.album_art_url ? (
        <img 
          src={nowPlaying.album_art_url}
          alt="Album art"
          className="absolute inset-0 w-full h-full object-cover opacity-80"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-primary/5" />
      )}
      
      {/* Gradient Overlay for Text Readability */}
      <div 
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(to right, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 50%, rgba(0,0,0,0.15) 100%)',
        }}
      />
      
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
              shouldScroll ? 'animate-marquee' : ''
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
