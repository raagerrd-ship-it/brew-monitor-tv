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
        console.log('[Sonos] Init starting...');
        const [settingsResult, nowPlayingResult] = await Promise.all([
          (supabase as any)
            .from('sonos_settings')
            .select('show_on_dashboard, selected_group_id, track_change_offset_seconds, prefetch_seconds')
            .limit(1)
            .maybeSingle(),
          (supabase as any)
            .from('sonos_now_playing')
            .select('track_name, artist_name, album_name, album_art_url, bg_image_url, widget_art_url, duration_ms, position_ms, playback_state')
            .limit(1)
            .maybeSingle(),
        ]);

        const { data: settings, error: settingsError } = settingsResult;

        if (settingsError) {
          console.error('[Sonos] Settings query error:', settingsError);
          setIsConnected(false);
          return;
        }

        if (!settings?.selected_group_id) {
          console.warn('[Sonos] No selected_group_id in settings:', settings);
          setIsConnected(false);
          return;
        }

        console.log('[Sonos] Init connected, group:', settings.selected_group_id);
        setIsConnected(true);
        const show = settings?.show_on_dashboard ?? true;
        setShowWidget(show);
        trackChangeOffsetRef.current = Number(settings?.track_change_offset_seconds) || 0;
        prefetchSecondsRef.current = Number(settings?.prefetch_seconds) || 30;

        const { data: npData, error: npError } = nowPlayingResult;
        if (npError) {
          console.warn('[Sonos] Now playing query error:', npError);
        }
        if (npData && !npError && show) {
          console.log('[Sonos] Init now playing:', npData.track_name, '- state:', npData.playback_state);
          setNowPlaying(npData);
          localProgressRef.current = npData.position_ms;
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
