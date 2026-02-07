import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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
    // Parallel fetch: tokens and settings
    const [tokenResult, settingsResult] = await Promise.all([
      supabase.from('sonos_tokens').select('*').limit(1).single(),
      supabase.from('sonos_settings').select('selected_group_id').limit(1).single(),
    ]);

    const tokenData = tokenResult.data;
    const groupId = settingsResult.data?.selected_group_id;

    if (!tokenData || !groupId) {
      return new Response(JSON.stringify({ ok: false, reason: 'not_configured' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Refresh token if expired
    let accessToken = tokenData.access_token;
    const isExpired = new Date(tokenData.expires_at) < new Date();

    if (isExpired) {
      const tokenResponse = await fetch('https://api.sonos.com/login/v3/oauth/access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${btoa(`${SONOS_CLIENT_ID}:${SONOS_CLIENT_SECRET}`)}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: tokenData.refresh_token,
        }),
      });

      if (!tokenResponse.ok) {
        return new Response(JSON.stringify({ ok: false, reason: 'token_refresh_failed' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const tokens = await tokenResponse.json();
      accessToken = tokens.access_token;
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

      // Fire-and-forget token update
      supabase.from('sonos_tokens').update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt.toISOString(),
      }).eq('id', tokenData.id).then(() => {});
    }

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

    return new Response(JSON.stringify({
      ok: true,
      playbackState: playbackData.playbackState || 'IDLE',
      positionMillis: playbackData.positionMillis || 0,
      trackName: track?.name || null,
      artistName: track?.artist?.name || null,
      albumName: track?.album?.name || null,
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
