import { useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface NowPlaying {
  track_name: string | null;
  artist_name: string | null;
  album_art_url: string | null;
  next_album_art_url?: string | null;
  duration_ms: number | null;
  position_ms: number | null;
  playback_state: string;
}

interface TrackTransitionActions {
  setNowPlaying: (data: NowPlaying | null) => void;
  setLocalProgress: React.Dispatch<React.SetStateAction<number | null>>;
}

/**
 * Hook that manages track data flow for the Sonos widget.
 * Image state is handled by the widget itself via displayedArtUrl.
 */
export function useSonosTrackTransition(
  actions: TrackTransitionActions
) {
  const { setNowPlaying, setLocalProgress } = actions;
  const currentTrackRef = useRef<string | null>(null);
  const isFetchingRef = useRef(false);

  // Fetch now playing data from database (one-time on mount)
  const fetchNowPlaying = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    try {
      const { data, error } = await (supabase as any)
        .from('sonos_now_playing')
        .select('track_name, artist_name, album_art_url, next_album_art_url, bg_image_url, next_bg_image_url, duration_ms, position_ms, playback_state')
        .limit(1)
        .maybeSingle();

      if (data && !error) {
        currentTrackRef.current = data.track_name;
        setNowPlaying(data);
        setLocalProgress(data.position_ms);
      }
    } catch (error) {
      console.error('[Sonos] Failed to fetch from DB:', error);
    } finally {
      isFetchingRef.current = false;
    }
  }, [setNowPlaying, setLocalProgress]);

  // Handle track change from realtime
  const handleTrackUpdate = useCallback((newData: NowPlaying) => {
    currentTrackRef.current = newData.track_name;
    setNowPlaying(newData);
    setLocalProgress(newData.position_ms);
  }, [setNowPlaying, setLocalProgress]);

  return {
    fetchNowPlaying,
    handleTrackUpdate,
  };
}
