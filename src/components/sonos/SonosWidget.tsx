import { memo, useEffect, useState, useRef } from "react";
import { Music } from "lucide-react";
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

  // Local progress interpolation (update every second while playing)
  useEffect(() => {
    if (!nowPlaying || nowPlaying.playback_state !== 'PLAYBACK_STATE_PLAYING') {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      return;
    }

    progressIntervalRef.current = window.setInterval(() => {
      setLocalProgress((prev) => {
        if (prev === null || !nowPlaying.duration_ms) return prev;
        const elapsed = Date.now() - lastUpdateRef.current;
        const newProgress = (nowPlaying.position_ms ?? 0) + elapsed;
        return Math.min(newProgress, nowPlaying.duration_ms);
      });
    }, 1000);

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    };
  }, [nowPlaying]);

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
  const albumSize = isTvMode ? 'min(12vh, 120px)' : isMobile ? '32px' : 'min(5vh, 48px)';
  const iconSize = isTvMode ? 'min(6vh, 60px)' : isMobile ? '1rem' : 'min(2.5vh, 1.25rem)';
  const trackFontSize = isTvMode ? 'min(4vh, 1.5rem)' : isMobile ? '0.8rem' : 'min(2vh, 0.9rem)';
  const artistFontSize = isTvMode ? 'min(3vh, 1.2rem)' : isMobile ? '0.7rem' : 'min(1.6vh, 0.75rem)';
  const progressHeight = isTvMode ? 'min(0.8vh, 6px)' : isMobile ? '2px' : 'min(0.4vh, 3px)';
  const maxWidth = isTvMode ? 'min(45vw, 500px)' : isMobile ? '200px' : 'min(35vw, 320px)';

  return (
    <div 
      className={`flex items-center rounded-xl overflow-hidden transition-all duration-300 animate-fade-in ${
        isTvMode ? 'gap-5 px-5 py-4' : isMobile ? 'gap-3 px-2 py-1.5' : 'gap-3 px-3 py-2'
      }`}
      style={{
        background: 'hsl(222 20% 11% / 0.95)',
        border: '1px solid hsl(222 15% 22%)',
        maxWidth,
        backdropFilter: 'blur(12px)',
        boxShadow: isTvMode 
          ? '0 25px 50px -12px rgba(0, 0, 0, 0.6), 0 12px 24px -8px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.05)'
          : '0 10px 25px -5px rgba(0, 0, 0, 0.3)',
      }}
    >
      {/* Album Art or Music Icon */}
      {nowPlaying.album_art_url ? (
        <img 
          src={nowPlaying.album_art_url}
          alt="Album art"
          className="flex-shrink-0 rounded-lg object-cover"
          style={{ 
            width: albumSize,
            height: albumSize,
            boxShadow: isTvMode ? '0 8px 16px rgba(0, 0, 0, 0.4)' : undefined,
          }}
          onError={(e) => {
            e.currentTarget.style.display = 'none';
            e.currentTarget.nextElementSibling?.classList.remove('hidden');
          }}
        />
      ) : null}
      <div 
        className={`flex-shrink-0 flex items-center justify-center rounded-lg bg-primary/10 ${nowPlaying.album_art_url ? 'hidden' : ''}`}
        style={{ 
          width: albumSize,
          height: albumSize,
        }}
      >
        <Music 
          className="text-primary/70" 
          style={{ 
            width: iconSize,
            height: iconSize,
          }} 
        />
      </div>
      
      {/* Track Info */}
      <div className="flex flex-col min-w-0 flex-1">
        <div 
          ref={containerRef}
          className="overflow-hidden"
        >
          <div 
            ref={textRef}
            className={`whitespace-nowrap font-medium text-foreground ${
              shouldScroll ? 'animate-marquee' : ''
            }`}
            style={{ fontSize: trackFontSize }}
          >
            {nowPlaying.track_name}
          </div>
        </div>
        {nowPlaying.artist_name && (
          <div 
            className="truncate text-muted-foreground"
            style={{ fontSize: artistFontSize }}
          >
            {nowPlaying.artist_name}
          </div>
        )}
        
        {/* Progress Bar */}
        {nowPlaying.duration_ms && (
          <div 
            className="w-full mt-2 rounded-full overflow-hidden"
            style={{
              height: progressHeight,
              background: 'hsl(222 15% 25%)',
            }}
          >
            <div 
              className="h-full rounded-full transition-[width] duration-1000 ease-linear"
              style={{
                width: `${progressPercent}%`,
                background: 'hsl(var(--primary))',
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
});
