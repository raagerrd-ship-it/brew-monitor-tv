import { memo, useEffect, useState, useRef } from "react";
import { Music } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface NowPlaying {
  track_name: string | null;
  artist_name: string | null;
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
      className={`flex items-center gap-2 rounded-lg overflow-hidden transition-opacity duration-300 ${
        isMobile ? 'px-2 py-1 max-w-[180px]' : 'px-3 py-1.5'
      }`}
      style={{
        background: 'hsl(222 20% 11%)',
        border: '1px solid hsl(222 15% 18%)',
        maxWidth: isMobile ? '180px' : 'min(30vw, 280px)',
      }}
    >
      <Music 
        className="flex-shrink-0 text-primary/70" 
        style={{ 
          width: isMobile ? '0.9rem' : 'min(2vh, 1rem)',
          height: isMobile ? '0.9rem' : 'min(2vh, 1rem)',
        }} 
      />
      
      <div 
        ref={containerRef}
        className="overflow-hidden flex-1"
      >
        <div 
          ref={textRef}
          className={`whitespace-nowrap text-muted-foreground ${
            shouldScroll ? 'animate-marquee' : ''
          }`}
          style={{
            fontSize: isMobile ? '0.75rem' : 'min(2vh, 0.875rem)',
          }}
        >
          {displayText}
        </div>
      </div>
    </div>
  );
});
