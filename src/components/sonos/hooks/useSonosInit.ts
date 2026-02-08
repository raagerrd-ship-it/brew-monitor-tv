import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { NowPlaying } from './types';

interface UseSonosInitParams {
  setNowPlaying: React.Dispatch<React.SetStateAction<NowPlaying | null>>;
  localProgressRef: React.MutableRefObject<number | null>;
  trackChangeOffsetRef: React.MutableRefObject<number>;
  prefetchSecondsRef: React.MutableRefObject<number>;
}

/**
 * Parallel fetch of settings + now playing on mount.
 * Returns connection state and widget visibility.
 */
export function useSonosInit(params: UseSonosInitParams) {
  const { setNowPlaying, localProgressRef, trackChangeOffsetRef, prefetchSecondsRef } = params;
  const [isConnected, setIsConnected] = useState(false);
  const [showWidget, setShowWidget] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        const [settingsResult, nowPlayingResult] = await Promise.all([
          (supabase as any)
            .from('sonos_settings')
            .select('show_on_dashboard, selected_group_id, track_change_offset_seconds, prefetch_seconds')
            .limit(1)
            .maybeSingle(),
          (supabase as any)
            .from('sonos_now_playing')
            .select('track_name, artist_name, album_art_url, next_album_art_url, bg_image_url, next_bg_image_url, widget_art_url, next_widget_art_url, duration_ms, position_ms, playback_state')
            .limit(1)
            .maybeSingle(),
        ]);

        const { data: settings, error: settingsError } = settingsResult;

        if (settingsError || !settings?.selected_group_id) {
          setIsConnected(false);
          return;
        }

        setIsConnected(true);
        const show = settings?.show_on_dashboard ?? true;
        setShowWidget(show);
        trackChangeOffsetRef.current = Number(settings?.track_change_offset_seconds) || 0;
        prefetchSecondsRef.current = Number(settings?.prefetch_seconds) || 30;

        const { data: npData, error: npError } = nowPlayingResult;
        if (npData && !npError && show) {
          setNowPlaying(npData);
          localProgressRef.current = npData.position_ms;
          // DOM progress update will happen on next ticker tick
        }
      } catch (error) {
        console.error('[Sonos] Failed to init:', error);
        setIsConnected(false);
      }
    };

    init();
  }, []);

  return { isConnected, showWidget };
}
