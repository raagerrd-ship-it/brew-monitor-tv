import { memo, useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface NowPlaying {
  track_name: string | null;
  artist_name: string | null;
  album_art_url: string | null;
  duration_ms: number | null;
  position_ms: number | null;
  playback_state: string;
}

interface SpotifyTrackInfo {
  tempo: number | null;
  energy: number | null;
}

interface SonosWidgetProps {
  isMobile?: boolean;
  isTvMode?: boolean;
  onAlbumArtChange?: (url: string | null) => void;
  onTempoChange?: (tempo: number | null) => void;
  onEnergyChange?: (energy: number | null) => void;
  onNextAlbumArtPreload?: (url: string | null) => void;
}

export const SonosWidget = memo(function SonosWidget({ isMobile = false, isTvMode = false, onAlbumArtChange, onTempoChange, onEnergyChange, onNextAlbumArtPreload }: SonosWidgetProps) {
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [showWidget, setShowWidget] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [localProgress, setLocalProgress] = useState<number | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [spotifyInfo, setSpotifyInfo] = useState<SpotifyTrackInfo | null>(null);
  const [nextTrackAlbumArt, setNextTrackAlbumArt] = useState<string | null>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldScroll, setShouldScroll] = useState(false);
  const pollIntervalRef = useRef<number | null>(null);
  const progressIntervalRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(Date.now());
  const trackEndFetchedRef = useRef<boolean>(false);
  const nextTrackPreloadedRef = useRef<boolean>(false);
  const currentTrackRef = useRef<string | null>(null);
  const spotifyFetchedTrackRef = useRef<string | null>(null);

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
          // Reset flags when track changes
          if (response.data.track_name !== currentTrackRef.current) {
            trackEndFetchedRef.current = false;
            nextTrackPreloadedRef.current = false;
            currentTrackRef.current = response.data.track_name;
            // Reset image state for new track
            setImageLoaded(false);
            setImageError(false);
            setNextTrackAlbumArt(null);
          }
          setNowPlaying(response.data);
          setLocalProgress(response.data.position_ms);
          lastUpdateRef.current = Date.now();
          
          // Preload album art immediately when we get new track data
          if (response.data.album_art_url) {
            const img = new Image();
            img.src = response.data.album_art_url;
          }
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
          // Reset flags when track changes via realtime
          if (newData.track_name !== currentTrackRef.current) {
            trackEndFetchedRef.current = false;
            nextTrackPreloadedRef.current = false;
            currentTrackRef.current = newData.track_name;
            // Reset image state for new track
            setImageLoaded(false);
            setImageError(false);
            setNextTrackAlbumArt(null);
          }
          setNowPlaying(newData);
          setLocalProgress(newData.position_ms);
          lastUpdateRef.current = Date.now();
          
          // Preload album art immediately when we get new track data via realtime
          if (newData.album_art_url) {
            const img = new Image();
            img.src = newData.album_art_url;
          }
        }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isConnected, showWidget]);

  // Notify parent about album art changes
  useEffect(() => {
    if (onAlbumArtChange) {
      if (nowPlaying?.album_art_url && imageLoaded && !imageError) {
        onAlbumArtChange(nowPlaying.album_art_url);
      } else {
        onAlbumArtChange(null);
      }
    }
  }, [nowPlaying?.album_art_url, imageLoaded, imageError, onAlbumArtChange]);

  // Generate pseudo-random but deterministic values from track name
  // This creates consistent tempo/energy for each unique song
  const generatePseudoAudioFeatures = useCallback((trackName: string, artistName: string) => {
    const combined = `${trackName}|${artistName}`;
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    
    // Generate tempo between 80-160 BPM (most music falls in this range)
    const tempo = 80 + Math.abs(hash % 80);
    
    // Generate energy between 0.3-0.9 (avoid extremes)
    const energySeed = Math.abs((hash >> 8) % 60);
    const energy = 0.3 + (energySeed / 100);
    
    return { tempo, energy };
  }, []);

  // Fetch Spotify BPM/tempo when track changes, fallback to pseudo-random
  const fetchSpotifyInfo = useCallback(async (trackName: string, artistName: string) => {
    const trackKey = `${trackName}|${artistName}`;
    
    // Skip if already fetched for this track
    if (spotifyFetchedTrackRef.current === trackKey) return;
    
    spotifyFetchedTrackRef.current = trackKey;
    
    try {
      const response = await supabase.functions.invoke('spotify-track-info', {
        body: { trackName, artistName }
      });
      
      // Check if Spotify returned real data
      if (response.data && !response.error && response.data.tempo && !response.data.notConfigured) {
        setSpotifyInfo({
          tempo: response.data.tempo,
          energy: response.data.energy
        });
        onTempoChange?.(response.data.tempo);
        onEnergyChange?.(response.data.energy);
        return;
      }
    } catch {
      // Silent fail - will use fallback
    }
    
    // Fallback: Generate pseudo-random values based on track name
    const pseudoFeatures = generatePseudoAudioFeatures(trackName, artistName);
    setSpotifyInfo(pseudoFeatures);
    onTempoChange?.(pseudoFeatures.tempo);
    onEnergyChange?.(pseudoFeatures.energy);
  }, [onTempoChange, onEnergyChange, generatePseudoAudioFeatures]);

  // Trigger audio features fetch when track changes
  useEffect(() => {
    if (!nowPlaying?.track_name || !nowPlaying?.artist_name) {
      setSpotifyInfo(null);
      onTempoChange?.(null);
      onEnergyChange?.(null);
      return;
    }
    
    fetchSpotifyInfo(nowPlaying.track_name, nowPlaying.artist_name);
  }, [nowPlaying?.track_name, nowPlaying?.artist_name, fetchSpotifyInfo, onTempoChange, onEnergyChange]);

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

    const fetchNowPlayingAndPreload = async () => {
      try {
        const response = await supabase.functions.invoke('sonos-now-playing');
        if (response.data && !response.error) {
          const newTrack = response.data.track_name !== currentTrackRef.current;
          if (newTrack) {
            trackEndFetchedRef.current = false;
            nextTrackPreloadedRef.current = false;
            currentTrackRef.current = response.data.track_name;
            setImageLoaded(false);
            setImageError(false);
            setNextTrackAlbumArt(null);
          }
          setNowPlaying(response.data);
          setLocalProgress(response.data.position_ms);
          lastUpdateRef.current = Date.now();
          
          // Immediately preload album art for instant display
          if (response.data.album_art_url) {
            const img = new Image();
            img.src = response.data.album_art_url;
            // Notify parent to preload in background component
            onNextAlbumArtPreload?.(response.data.album_art_url);
          }
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
        
        // Early preload: Start fetching 5 seconds before track ends
        // This gives us time to get next track info and preload its album art
        if (remaining <= 5000 && remaining > 0 && !nextTrackPreloadedRef.current) {
          nextTrackPreloadedRef.current = true;
          // Fetch now to get next track info as early as possible
          fetchNowPlayingAndPreload();
        }
        
        // Smart track-end detection: schedule final fetch just after track should end
        if (remaining <= 1500 && remaining > 0 && !trackEndFetchedRef.current) {
          trackEndFetchedRef.current = true;
          setTimeout(fetchNowPlayingAndPreload, remaining + 200);
        }
        
        return Math.min(newProgress, nowPlaying.duration_ms);
      });
    }, 500); // Check more frequently for smoother transitions

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    };
  }, [isConnected, showWidget, nowPlaying, onNextAlbumArtPreload]);

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

      {/* Album art background */}
      {nowPlaying.album_art_url && !imageError && (
        <img
          src={nowPlaying.album_art_url}
          alt=""
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setImageLoaded(true)}
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