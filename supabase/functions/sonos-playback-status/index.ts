
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * sonos-playback-status — pure DB read.
 * All data is pushed by Cast Away (UPnP bridge) via sonos-bridge-push.
 * No Sonos Cloud API calls needed.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    const { data: np } = await supabase
      .from('sonos_now_playing')
      .select('*')
      .limit(1)
      .single();

    if (!np) {
      return new Response(JSON.stringify({ ok: false, reason: 'not_configured' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      playbackState: np.playback_state || 'IDLE',
      positionMillis: np.position_ms || 0,
      durationMillis: np.duration_ms || null,
      trackName: np.track_name || null,
      artistName: np.artist_name || null,
      albumName: np.album_name || null,
      nextTrackName: np.next_track_name || null,
      nextArtistName: np.next_artist_name || null,
      nextAlbumArtUrl: np.next_album_art_url || null,
      trackSeq: np.track_seq ?? 0,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[SonosPlaybackStatus] Error:', error);
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
