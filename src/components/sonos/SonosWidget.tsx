import { memo, useEffect, useState, useRef } from "react";
import { Music } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface NowPlaying {
  track_name: string | null;
  artist_name: string | null;
  album_art_url: string | null;
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
  const textRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldScroll, setShouldScroll] = useState(false);
  const pollIntervalRef = useRef<number | null>(null);

  // Check if connected and fetch initial data
  useEffect(() => {
    const checkConnection = async () => {
      try {
        // Use any type to avoid TypeScript errors until types are regenerated
        const { data: settings, error: settingsError } = await (supabase as any)
          .from('sonos_settings')
          .select('show_on_dashboard')
          .limit(1)
          .maybeSingle();

        const { data: tokens, error: tokensError } = await (supabase as any)
          .from('sonos_tokens')
          .select('id')
          .limit(1)
          .maybeSingle();

        // If we get errors (like 406), treat as not connected
        if (tokensError || !tokens) {
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
            setNowPlaying(payload.new as NowPlaying);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isConnected, showWidget]);

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

  const displayText = nowPlaying.artist_name 
    ? `${nowPlaying.track_name} • ${nowPlaying.artist_name}`
    : nowPlaying.track_name;

  return (
    <div 
      className={`flex items-center gap-3 rounded-xl overflow-hidden transition-all duration-300 animate-fade-in ${
        isMobile ? 'px-2 py-1.5 max-w-[200px]' : 'px-3 py-2'
      }`}
      style={{
        background: 'hsl(222 20% 11% / 0.95)',
        border: '1px solid hsl(222 15% 22%)',
        maxWidth: isMobile ? '200px' : 'min(35vw, 320px)',
        backdropFilter: 'blur(8px)',
      }}
    >
      {/* Album Art or Music Icon */}
      {nowPlaying.album_art_url ? (
        <img 
          src={nowPlaying.album_art_url}
          alt="Album art"
          className="flex-shrink-0 rounded-md object-cover"
          style={{ 
            width: isMobile ? '32px' : 'min(5vh, 48px)',
            height: isMobile ? '32px' : 'min(5vh, 48px)',
          }}
          onError={(e) => {
            // Fallback to music icon if image fails
            e.currentTarget.style.display = 'none';
            e.currentTarget.nextElementSibling?.classList.remove('hidden');
          }}
        />
      ) : null}
      <div 
        className={`flex-shrink-0 flex items-center justify-center rounded-md bg-primary/10 ${nowPlaying.album_art_url ? 'hidden' : ''}`}
        style={{ 
          width: isMobile ? '32px' : 'min(5vh, 48px)',
          height: isMobile ? '32px' : 'min(5vh, 48px)',
        }}
      >
        <Music 
          className="text-primary/70" 
          style={{ 
            width: isMobile ? '1rem' : 'min(2.5vh, 1.25rem)',
            height: isMobile ? '1rem' : 'min(2.5vh, 1.25rem)',
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
            style={{
              fontSize: isMobile ? '0.8rem' : 'min(2vh, 0.9rem)',
            }}
          >
            {nowPlaying.track_name}
          </div>
        </div>
        {nowPlaying.artist_name && (
          <div 
            className="truncate text-muted-foreground"
            style={{
              fontSize: isMobile ? '0.7rem' : 'min(1.6vh, 0.75rem)',
            }}
          >
            {nowPlaying.artist_name}
          </div>
        )}
      </div>
    </div>
  );
});
