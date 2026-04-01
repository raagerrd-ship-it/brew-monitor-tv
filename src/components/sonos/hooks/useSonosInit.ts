import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { NowPlaying } from './types';

interface UseSonosInitParams {
  setNowPlaying: React.Dispatch<React.SetStateAction<NowPlaying | null>>;
  localProgressRef: React.MutableRefObject<number | null>;
  acceptedSeqRef: React.MutableRefObject<number>;
}

/**
 * Parallel fetch of settings + now playing on mount.
 * Seeds acceptedSeqRef with the initial track_seq from DB.
 */
export function useSonosInit(params: UseSonosInitParams) {
  const { setNowPlaying, localProgressRef, acceptedSeqRef } = params;
  const [isConnected, setIsConnected] = useState(false);
  const [showWidget, setShowWidget] = useState(false);
  const [trackChangeOffsetMs, setTrackChangeOffsetMs] = useState(2000);

  useEffect(() => {
    const init = async () => {
      try {
        const [settingsResult, nowPlayingResult] = await Promise.all([
          supabase
            .from('sonos_settings')
            .select('show_on_dashboard, selected_group_id, track_change_offset_seconds')
            .limit(1)
            .maybeSingle(),
          supabase
            .from('sonos_now_playing')
            .select('track_name, artist_name, album_name, album_art_url, bg_image_url, duration_ms, position_ms, playback_state, updated_at, next_track_name, next_artist_name, next_album_art_url, next_bg_image_url, track_seq, media_type, bg_cached, next_bg_cached, bg_generation_ms, next_bg_generation_ms')
            .order('updated_at', { ascending: false })
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
        setTrackChangeOffsetMs((Number(settings?.track_change_offset_seconds) || 2.0) * 1000);

        const { data: npData, error: npError } = nowPlayingResult;
        if (npData && !npError && show) {
          const PAUSE_TIMEOUT_MS = 5 * 60 * 1000;
          const isPausedOrIdle = npData.playback_state === 'PLAYBACK_STATE_PAUSED' || npData.playback_state === 'PLAYBACK_STATE_IDLE';
          const stalePause = isPausedOrIdle && npData.updated_at && (Date.now() - new Date(npData.updated_at).getTime()) > PAUSE_TIMEOUT_MS;

          if (npData.playback_state !== 'PLAYBACK_STATE_IDLE' && !stalePause) {
            setNowPlaying(npData);
            localProgressRef.current = npData.position_ms;
            // Seed the monotonic seq gate
            if (typeof npData.track_seq === 'number') {
              acceptedSeqRef.current = npData.track_seq;
            }
          }
        }
      } catch {
        setIsConnected(false);
      }
    };

    init();
  }, []);

  return { isConnected, showWidget, trackChangeOffsetMs };
}
