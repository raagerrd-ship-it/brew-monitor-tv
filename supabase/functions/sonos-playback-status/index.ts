import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getValidAccessToken } from "../_shared/sonos-token.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SONOS_API_URL = 'https://api.ws.sonos.com/control/api/v1';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const SONOS_CLIENT_ID = Deno.env.get('SONOS_CLIENT_ID');
  const SONOS_CLIENT_SECRET = Deno.env.get('SONOS_CLIENT_SECRET');

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    // Parallel fetch: token + settings
    const [tokenResult, settingsResult, nowPlayingResult] = await Promise.all([
      getValidAccessToken(supabase, SONOS_CLIENT_ID!, SONOS_CLIENT_SECRET!),
      supabase.from('sonos_settings').select('selected_group_id').limit(1).single(),
      supabase.from('sonos_now_playing').select('bg_image_url, next_bg_image_url, widget_art_url, next_widget_art_url, album_art_url').limit(1).maybeSingle(),
    ]);

    const groupId = settingsResult.data?.selected_group_id;

    if (!tokenResult || !groupId) {
      return new Response(JSON.stringify({ ok: false, reason: 'not_configured' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accessToken = tokenResult.accessToken;

    // Parallel fetch: playback status + metadata
    const [playbackResponse, metadataResponse] = await Promise.all([
      fetch(`${SONOS_API_URL}/groups/${groupId}/playback`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }),
      fetch(`${SONOS_API_URL}/groups/${groupId}/playbackMetadata`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }),
    ]);

    if (!playbackResponse.ok) {
      return new Response(JSON.stringify({ ok: false, reason: 'playback_fetch_failed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const [playbackData, metadata] = await Promise.all([
      playbackResponse.json(),
      metadataResponse.ok ? metadataResponse.json() : null,
    ]);

    const track = metadata?.currentItem?.track;
    const np = nowPlayingResult.data;

    return new Response(JSON.stringify({
      ok: true,
      playbackState: playbackData.playbackState || 'IDLE',
      positionMillis: playbackData.positionMillis || 0,
      durationMillis: track?.durationMillis || null,
      trackName: track?.name || null,
      artistName: track?.artist?.name || null,
      albumName: track?.album?.name || null,
      // DB art URLs for client sync
      bgImageUrl: np?.bg_image_url || null,
      nextBgImageUrl: np?.next_bg_image_url || null,
      widgetArtUrl: np?.widget_art_url || null,
      nextWidgetArtUrl: np?.next_widget_art_url || null,
      albumArtUrl: np?.album_art_url || null,
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
