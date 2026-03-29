
import { createClient } from "npm:@supabase/supabase-js@2";
import { getValidAccessToken } from "../_shared/sonos-token.ts";
import { recoverGroupByName } from "../_shared/sonos-group-recovery.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const SONOS_API_URL = 'https://api.ws.sonos.com/control/api/v1';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const SONOS_CLIENT_ID = Deno.env.get('SONOS_CLIENT_ID');
  const SONOS_CLIENT_SECRET = Deno.env.get('SONOS_CLIENT_SECRET');

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    // Parallel fetch: token + settings (art URLs come from init + realtime, not needed here)
    const [tokenResult, settingsResult] = await Promise.all([
      getValidAccessToken(supabase, SONOS_CLIENT_ID!, SONOS_CLIENT_SECRET!),
      supabase.from('sonos_settings').select('id, selected_group_id, selected_group_name').limit(1).single(),
    ]);

    let groupId = settingsResult.data?.selected_group_id;
    const groupName = settingsResult.data?.selected_group_name;
    const settingsId = settingsResult.data?.id;

    if (!tokenResult || !groupId) {
      return new Response(JSON.stringify({ ok: false, reason: 'not_configured' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accessToken = tokenResult.accessToken;

    // Parallel fetch: playback status + metadata
    let [playbackResponse, metadataResponse] = await Promise.all([
      fetch(`${SONOS_API_URL}/groups/${groupId}/playback`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }),
      fetch(`${SONOS_API_URL}/groups/${groupId}/playbackMetadata`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }),
    ]);

    // Group ID may have changed — recover by name
    if (!playbackResponse.ok && settingsId && groupName) {
      const recovered = await recoverGroupByName(supabase, accessToken, groupName, settingsId, null);
      if (recovered) {
        groupId = recovered.groupId;
        [playbackResponse, metadataResponse] = await Promise.all([
          fetch(`${SONOS_API_URL}/groups/${groupId}/playback`, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
          }),
          fetch(`${SONOS_API_URL}/groups/${groupId}/playbackMetadata`, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
          }),
        ]);
      }
    }

    if (!playbackResponse.ok) {
      return new Response(JSON.stringify({ ok: false, reason: 'playback_fetch_failed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const [playbackData, metadata] = await Promise.all([
      playbackResponse.json(),
      metadataResponse.ok ? metadataResponse.json() : null,
    ]);

    // Fetch track_seq from DB
    const { data: npRow } = await supabase
      .from('sonos_now_playing')
      .select('track_seq')
      .limit(1)
      .single();

    const track = metadata?.currentItem?.track;
    const nextTrack = metadata?.nextItem?.track;

    return new Response(JSON.stringify({
      ok: true,
      playbackState: playbackData.playbackState || 'IDLE',
      positionMillis: playbackData.positionMillis || 0,
      durationMillis: track?.durationMillis || null,
      trackName: track?.name || null,
      artistName: track?.artist?.name || null,
      albumName: track?.album?.name || null,
      nextTrackName: nextTrack?.name || null,
      nextArtistName: nextTrack?.artist?.name || null,
      nextAlbumArtUrl: nextTrack?.imageUrl || null,
      trackSeq: npRow?.track_seq ?? 0,
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
