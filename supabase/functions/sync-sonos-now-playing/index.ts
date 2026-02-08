import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getValidAccessToken } from "../_shared/sonos-token.ts";
import type { BgSettings } from "../_shared/image-processing.ts";
import { resolveBackgroundAndWidget, cleanupOldBackgrounds } from "../_shared/sonos-storage.ts";
import { resolveAlbumArt } from "../_shared/sonos-art.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SONOS_API_URL = 'https://api.ws.sonos.com/control/api/v1';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const SONOS_CLIENT_ID = Deno.env.get('SONOS_CLIENT_ID');
  const SONOS_CLIENT_SECRET = Deno.env.get('SONOS_CLIENT_SECRET');

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  // Fixed resolution for background images (matches locked 720p layout)
  const viewportW = 1280;
  const viewportH = 720;

  try {
    // Fetch settings
    const { data: settings } = await supabase
      .from('sonos_settings')
      .select('id, selected_group_id, bg_blur, bg_brightness, bg_contrast, bg_saturation, bg_top_gradient_opacity, bg_top_gradient_height')
      .limit(1)
      .single();

    const bgSettings: BgSettings = {
      blur: settings?.bg_blur ?? 40,
      brightness: settings?.bg_brightness ?? 90,
      contrast: settings?.bg_contrast ?? 1.0,
      saturation: settings?.bg_saturation ?? 1.0,
      topGradientOpacity: settings?.bg_top_gradient_opacity ?? 0.45,
      topGradientHeight: settings?.bg_top_gradient_height ?? 85,
    };

    // Get valid access token (refresh if expired)
    const tokenResult = await getValidAccessToken(supabase, SONOS_CLIENT_ID!, SONOS_CLIENT_SECRET!);

    if (!tokenResult) {
      console.error('[SonosSync] Failed to get valid token');
      return new Response(JSON.stringify({ ok: false, reason: 'token_refresh_failed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accessToken = tokenResult.accessToken;
    let groupId = settings?.selected_group_id;

    if (!groupId) {
      const householdsResponse = await fetch(`${SONOS_API_URL}/households`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });
      if (!householdsResponse.ok) {
        return new Response(JSON.stringify({ ok: false, reason: 'no_households' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const householdsData = await householdsResponse.json();
      if (householdsData.households?.length > 0) {
        const householdId = householdsData.households[0].id;
        const groupsResponse = await fetch(`${SONOS_API_URL}/households/${householdId}/groups`, {
          headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        if (groupsResponse.ok) {
          const groupsData = await groupsResponse.json();
          if (groupsData.groups?.length > 0) {
            groupId = groupsData.groups[0].id;
            await supabase.from('sonos_settings').upsert({
              id: settings?.id || crypto.randomUUID(),
              selected_group_id: groupId,
              selected_group_name: groupsData.groups[0].name,
            });
            await supabase.from('sonos_tokens').update({ household_id: householdId }).eq('id', tokenResult.tokenId);
          }
        }
      }
    }

    if (!groupId) {
      return new Response(JSON.stringify({ ok: false, reason: 'no_group' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // PARALLEL fetch: metadata and playback status
    const [metadataResponse, playbackResponse] = await Promise.all([
      fetch(`${SONOS_API_URL}/groups/${groupId}/playbackMetadata`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }),
      fetch(`${SONOS_API_URL}/groups/${groupId}/playback`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }),
    ]);

    if (!metadataResponse.ok) {
      await supabase.from('sonos_now_playing').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      return new Response(JSON.stringify({ ok: false, reason: 'metadata_failed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const [metadata, playbackData] = await Promise.all([
      metadataResponse.json(),
      playbackResponse.ok ? playbackResponse.json() : { playbackState: 'IDLE', positionMillis: 0 },
    ]);

    const playbackState = playbackData.playbackState || 'IDLE';
    const positionMs = playbackData.positionMillis || 0;
    const container = metadata.container;
    const currentItem = metadata.currentItem;
    const track = currentItem?.track;
    const nextItem = metadata.nextItem;
    const nextTrack = nextItem?.track;

    const rawCurrentArt = track?.imageUrl || container?.imageUrl || null;
    const rawNextArt = nextTrack?.imageUrl || null;

    const [currentArt, nextArt] = await Promise.all([
      resolveAlbumArt(rawCurrentArt, track?.id?.objectId || currentItem?.id?.objectId),
      resolveAlbumArt(rawNextArt, nextTrack?.id?.objectId || nextItem?.id?.objectId),
    ]);

    // Read existing row to check if we can reuse cached image URLs
    const { data: existingRow } = await supabase
      .from('sonos_now_playing')
      .select('id, track_name, bg_image_url, next_bg_image_url, widget_art_url, next_widget_art_url')
      .eq('group_id', groupId)
      .limit(1)
      .single();

    const currentTrackName = track?.name || container?.name || null;
    const sameTrack = existingRow && existingRow.track_name === currentTrackName;

    // Generate background images + widget thumbnails
    let bgImageUrl: string | null = null;
    let nextBgImageUrl: string | null = null;
    let widgetArtUrl: string | null = null;
    let nextWidgetArtUrl: string | null = null;

    if (currentArt.medium || nextArt.medium) {
      const currentTrackId = track?.id?.objectId || track?.name || '';
      const nextTrackId = nextTrack?.id?.objectId || nextTrack?.name || '';

      // Only reuse widget (settings-independent); background depends on settings hash
      // so we let resolveBackgroundAndWidget check the cache by filename
      const reuseCurrentWidget = sameTrack && existingRow.widget_art_url;
      const reuseNextWidget = sameTrack && existingRow.next_widget_art_url;

      const [currentResult, nextResult] = await Promise.all([
        currentArt.medium
          ? resolveBackgroundAndWidget(supabase, currentArt.medium, currentTrackId, bgSettings, viewportW, viewportH, reuseCurrentWidget || null)
          : Promise.resolve({ bgUrl: null, widgetUrl: reuseCurrentWidget || null }),
        nextArt.medium
          ? resolveBackgroundAndWidget(supabase, nextArt.medium, nextTrackId, bgSettings, viewportW, viewportH, reuseNextWidget || null)
          : Promise.resolve({ bgUrl: null, widgetUrl: reuseNextWidget || null }),
      ]);

      bgImageUrl = currentResult.bgUrl;
      nextBgImageUrl = nextResult.bgUrl;
      widgetArtUrl = currentResult.widgetUrl;
      nextWidgetArtUrl = nextResult.widgetUrl;

      // Cleanup old files (non-blocking)
      const keepFiles: string[] = [];
      for (const url of [bgImageUrl, nextBgImageUrl, widgetArtUrl, nextWidgetArtUrl]) {
        if (url) {
          const match = url.match(/\/([^/?]+)\?/);
          if (match) keepFiles.push(match[1]);
        }
      }
      if (keepFiles.length > 0) {
        cleanupOldBackgrounds(supabase, keepFiles).catch(() => {});
      }
    }

    const nowPlaying = {
      group_id: groupId,
      track_name: track?.name || container?.name || null,
      artist_name: track?.artist?.name || null,
      album_name: track?.album?.name || null,
      album_art_url: currentArt.medium,
      album_art_url_small: currentArt.small,
      next_album_art_url: nextArt.medium,
      playback_state: playbackState,
      duration_ms: track?.durationMillis || null,
      position_ms: positionMs,
      bg_image_url: bgImageUrl,
      next_bg_image_url: nextBgImageUrl,
      widget_art_url: widgetArtUrl,
      next_widget_art_url: nextWidgetArtUrl,
    };

    if (existingRow) {
      await supabase.from('sonos_now_playing').update(nowPlaying).eq('id', existingRow.id);
    } else {
      await supabase.from('sonos_now_playing').insert(nowPlaying);
    }

    const duration = Date.now() - startTime;
    console.log(`[SonosSync] Done in ${duration}ms - ${track?.name || 'no track'} (bg: ${bgImageUrl ? `${viewportW}x${viewportH}` : 'no'}, widget: ${widgetArtUrl ? 'yes' : 'no'})`);

    return new Response(JSON.stringify({ ok: true, duration_ms: duration }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[SonosSync] Error:', error);
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
