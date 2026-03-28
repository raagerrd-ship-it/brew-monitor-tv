
import { createClient } from "npm:@supabase/supabase-js@2";
import { getValidAccessToken } from "../_shared/sonos-token.ts";
import type { BgSettings } from "../_shared/image-processing.ts";
import { resolveBackgroundAndWidget, cleanupUnreferencedBackgrounds, storageObjectExistsByPublicUrl } from "../_shared/sonos-storage.ts";
import { resolveAlbumArt } from "../_shared/sonos-art.ts";
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

  const startTime = Date.now();

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const SONOS_CLIENT_ID = Deno.env.get('SONOS_CLIENT_ID');
  const SONOS_CLIENT_SECRET = Deno.env.get('SONOS_CLIENT_SECRET');

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  // Fixed resolution for background images (matches locked 720p layout)
  const viewportW = 1280;
  const viewportH = 720;

  // Check for bg_only mode (regenerate background without touching playback state)
  let bgOnly = false;
  try {
    const body = await req.json().catch(() => null);
    bgOnly = body?.bg_only === true;
  } catch { /* no body */ }

  try {
    // Parallel fetch: settings + token (biggest latency win)
    const [settingsResult, tokenResult] = await Promise.all([
      supabase.from('sonos_settings')
        .select('id, selected_group_id, selected_group_name, bg_blur, bg_brightness, bg_contrast, bg_saturation, bg_top_gradient_opacity, bg_top_gradient_height')
        .limit(1)
        .single(),
      getValidAccessToken(supabase, SONOS_CLIENT_ID!, SONOS_CLIENT_SECRET!),
    ]);

    const settings = settingsResult.data;
    const bgSettings: BgSettings = {
      blur: settings?.bg_blur ?? 40,
      brightness: settings?.bg_brightness ?? 90,
      contrast: settings?.bg_contrast ?? 1.0,
      saturation: settings?.bg_saturation ?? 1.0,
      topGradientOpacity: settings?.bg_top_gradient_opacity ?? 0.45,
      topGradientHeight: settings?.bg_top_gradient_height ?? 85,
    };

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
    let [metadataResponse, playbackResponse] = await Promise.all([
      fetch(`${SONOS_API_URL}/groups/${groupId}/playbackMetadata`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }),
      fetch(`${SONOS_API_URL}/groups/${groupId}/playback`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }),
    ]);

    // Group ID may have changed (Sonos regroups) — recover by name
    if (!metadataResponse.ok || !playbackResponse.ok) {
      const recovered = await recoverGroupByName(supabase, accessToken, settings?.selected_group_name, settings?.id, null);
      if (recovered) {
        groupId = recovered.groupId;
        console.log(`[SonosSync] Recovered group "${recovered.groupName}" → ${groupId}`);
        [metadataResponse, playbackResponse] = await Promise.all([
          fetch(`${SONOS_API_URL}/groups/${groupId}/playbackMetadata`, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
          }),
          fetch(`${SONOS_API_URL}/groups/${groupId}/playback`, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
          }),
        ]);
      }
    }

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

    // Read existing row (need updated_at for stale-pause check + cached image URLs)
    const { data: existingRow } = await supabase
      .from('sonos_now_playing')
      .select('id, track_name, bg_image_url, widget_art_url, next_bg_image_url, next_widget_art_url, next_track_name, updated_at, playback_state, album_art_url')
      .eq('group_id', groupId)
      .limit(1)
      .single();

    // --- bg_only mode: only regenerate background for existing track, don't touch playback state ---
    if (bgOnly) {
      const artUrl = existingRow?.album_art_url || null;
      if (!existingRow || !artUrl) {
        const duration = Date.now() - startTime;
        console.log(`[SonosSync] bg_only: no existing row or art → skip in ${duration}ms`);
        return new Response(JSON.stringify({ ok: true, bg_only: true, skipped: true, duration_ms: duration }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // Use ONLY the existing row's data — never the live Sonos API (song may have changed)
      const trackId = existingRow.track_name || '';
      const result = await resolveBackgroundAndWidget(supabase, artUrl, trackId, bgSettings, viewportW, viewportH, null, true, existingRow.track_name);
      if (result.bgUrl || result.widgetUrl) {
        const updateFields: Record<string, any> = { updated_at: new Date().toISOString() };
        if (result.bgUrl) updateFields.bg_image_url = result.bgUrl;
        if (result.widgetUrl) updateFields.widget_art_url = result.widgetUrl;
        await supabase.from('sonos_now_playing').update(updateFields).eq('id', existingRow.id);
        // Cleanup: keep only the images now referenced
        const { data: row } = await supabase.from('sonos_now_playing').select('bg_image_url, widget_art_url, next_bg_image_url, next_widget_art_url').eq('id', existingRow.id).single();
        if (row) cleanupUnreferencedBackgrounds(supabase, [row.bg_image_url, row.widget_art_url, row.next_bg_image_url, row.next_widget_art_url]).catch(() => {});
      }
      const duration = Date.now() - startTime;
      console.log(`[SonosSync] bg_only: regenerated for "${existingRow.track_name}" in ${duration}ms (bg: ${result.bgUrl ? 'yes' : 'no'}, widget: ${result.widgetUrl ? 'yes' : 'no'})`);
      return new Response(JSON.stringify({ ok: true, bg_only: true, duration_ms: duration }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // --- Server-side pause timeout (5 min) ---
    const PAUSE_TIMEOUT_MS = 5 * 60 * 1000;
    const sonosIsPausedOrIdle = playbackState === 'PLAYBACK_STATE_PAUSED' || playbackState === 'IDLE';

    if (sonosIsPausedOrIdle && existingRow) {
      const dbWasPaused = existingRow.playback_state === 'PLAYBACK_STATE_PAUSED';
      const dbWasIdle = existingRow.playback_state === 'PLAYBACK_STATE_IDLE';
      const msSinceUpdate = existingRow.updated_at ? Date.now() - new Date(existingRow.updated_at).getTime() : Infinity;

      // DB already IDLE — don't let cron rewrite PAUSED and restart the cycle
      if (dbWasIdle) {
        const duration = Date.now() - startTime;
        console.log(`[SonosSync] DB already IDLE, Sonos says ${playbackState} → skip write in ${duration}ms`);
        return new Response(JSON.stringify({ ok: true, idle: true, duration_ms: duration }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (dbWasPaused && msSinceUpdate > PAUSE_TIMEOUT_MS) {
        // Stale pause → write IDLE, skip images, return early
        await supabase.from('sonos_now_playing').update({
          playback_state: 'PLAYBACK_STATE_IDLE',
          position_ms: 0,
        }).eq('id', existingRow.id);

        // Delete ALL images — nothing is displayed in IDLE
        cleanupUnreferencedBackgrounds(supabase, []).catch(() => {});

        const duration = Date.now() - startTime;
        console.log(`[SonosSync] Stale pause (${Math.round(msSinceUpdate / 1000)}s) → IDLE in ${duration}ms`);
        return new Response(JSON.stringify({ ok: true, idle: true, duration_ms: duration }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (dbWasPaused && msSinceUpdate <= PAUSE_TIMEOUT_MS) {
        // Still paused, not yet stale → skip write to preserve original updated_at
        const duration = Date.now() - startTime;
        console.log(`[SonosSync] Still paused (${Math.round(msSinceUpdate / 1000)}s) → skip write in ${duration}ms`);
        return new Response(JSON.stringify({ ok: true, paused: true, duration_ms: duration }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const rawCurrentArt = track?.imageUrl || container?.imageUrl || null;

    const currentArt = await resolveAlbumArt(rawCurrentArt, track?.id?.objectId || currentItem?.id?.objectId, track?.name, track?.artist?.name);

    const currentTrackName = track?.name || container?.name || null;
    const sameTrack = existingRow && existingRow.track_name === currentTrackName;

    // Guard: don't overwrite valid track data with null from API hiccup
    if (!currentTrackName && existingRow?.track_name) {
      const duration = Date.now() - startTime;
      console.log(`[SonosSync] No track from API but DB has "${existingRow.track_name}" → skip write (${duration}ms)`);
      return new Response(JSON.stringify({ ok: true, skipped: true, duration_ms: duration }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Extract next track info from Sonos metadata
    const nextTrackName = nextTrack?.name || null;
    const nextArtistName = nextTrack?.artist?.name || null;
    const rawNextArt = nextTrack?.imageUrl || null;

    const metadataPayload: Record<string, any> = {
      group_id: groupId,
      track_name: currentTrackName,
      artist_name: track?.artist?.name || null,
      album_name: track?.album?.name || null,
      album_art_url: currentArt.medium,
      album_art_url_small: currentArt.small,
      next_track_name: nextTrackName,
      next_artist_name: nextArtistName,
      next_album_art_url: rawNextArt,
      playback_state: playbackState,
      duration_ms: track?.durationMillis || null,
      position_ms: positionMs,
      // Keep existing next-images if same track (they may already be processed), clear if new track
      ...(sameTrack ? {} : {
        next_bg_image_url: null,
        next_widget_art_url: null,
      }),
    };

    // --- For NEW tracks: write metadata immediately (fast UI text update), then images separately ---
    // --- For SAME track: process images first (cache hit = fast), then do ONE single write ---
    let rowId: string;

    if (!sameTrack) {
      // NEW TRACK: Phase 1 write for immediate text update via Realtime
      if (existingRow) {
        await supabase.from('sonos_now_playing').update(metadataPayload).eq('id', existingRow.id);
        rowId = existingRow.id;
      } else {
        const { data: inserted } = await supabase.from('sonos_now_playing').insert(metadataPayload).select('id').single();
        rowId = inserted?.id;
      }
      const phase1Ms = Date.now() - startTime;
      console.log(`[SonosSync] Phase 1 (metadata) done in ${phase1Ms}ms - NEW track "${currentTrackName}"`);
    } else {
      rowId = existingRow!.id;
    }

    // --- Process current track images ---
    let bgImageUrl: string | null = sameTrack ? (existingRow?.bg_image_url || null) : null;
    let widgetArtUrl: string | null = sameTrack ? (existingRow?.widget_art_url || null) : null;

    // Only treat existing URLs as cached if files actually still exist in storage.
    // This prevents startup with dead URLs (DB says cached, storage object deleted).
    let hasCachedBg = !!bgImageUrl;
    let hasCachedWidget = !!widgetArtUrl;
    const missingCachedBg = { value: false };
    const missingCachedWidget = { value: false };

    if (sameTrack && (hasCachedBg || hasCachedWidget)) {
      const [bgExists, widgetExists] = await Promise.all([
        hasCachedBg ? storageObjectExistsByPublicUrl(supabase, bgImageUrl!) : Promise.resolve(false),
        hasCachedWidget ? storageObjectExistsByPublicUrl(supabase, widgetArtUrl!) : Promise.resolve(false),
      ]);

      if (hasCachedBg && !bgExists) {
        console.log('[SonosSync] Cached bg URL missing in storage, regenerating current track image');
        bgImageUrl = null;
        hasCachedBg = false;
        missingCachedBg.value = true;
      }
      if (hasCachedWidget && !widgetExists) {
        console.log('[SonosSync] Cached widget URL missing in storage, regenerating current track image');
        widgetArtUrl = null;
        hasCachedWidget = false;
        missingCachedWidget.value = true;
      }
    }

    const needCurrentImages = !hasCachedBg || !hasCachedWidget;

    if (currentArt.medium && needCurrentImages) {
      const currentTrackId = track?.id?.objectId || track?.name || '';
      const reuseCurrentWidget = sameTrack && existingRow?.widget_art_url;

      const currentResult = await resolveBackgroundAndWidget(supabase, currentArt.medium, currentTrackId, bgSettings, viewportW, viewportH, reuseCurrentWidget || null, false, currentTrackName);

      bgImageUrl = currentResult.bgUrl;
      widgetArtUrl = currentResult.widgetUrl;
    }

    // --- Process next track images ---
    let nextBgUrl: string | null = null;
    let nextWidgetUrl: string | null = null;
    let nextAlbumArtMedium: string | null = null;

    // Skip if same next track with images already in DB
    const sameNextTrack = sameTrack && existingRow?.next_track_name === nextTrackName && existingRow?.next_bg_image_url && existingRow?.next_widget_art_url;
    if (sameNextTrack) {
      nextBgUrl = existingRow.next_bg_image_url;
      nextWidgetUrl = existingRow.next_widget_art_url;
      nextAlbumArtMedium = rawNextArt;
    } else if (rawNextArt && nextTrackName) {
      try {
        const nextArt = await resolveAlbumArt(rawNextArt, nextTrack?.id?.objectId || nextItem?.id?.objectId, nextTrack?.name, nextTrack?.artist?.name);
        if (nextArt.medium) {
          nextAlbumArtMedium = nextArt.medium;
          const nextTrackId = nextTrack?.id?.objectId || nextTrackName || '';
          const nextResult = await resolveBackgroundAndWidget(supabase, nextArt.medium, nextTrackId, bgSettings, viewportW, viewportH, null, false, nextTrackName);
          nextBgUrl = nextResult.bgUrl;
          nextWidgetUrl = nextResult.widgetUrl;
          console.log(`[SonosSync] Next track "${nextTrackName}" images ready (bg: ${!!nextBgUrl}, widget: ${!!nextWidgetUrl})`);
        }
      } catch (e) {
        console.error(`[SonosSync] Next track images error:`, e);
      }
    }

    // --- Final DB write ---
    if (rowId) {
      if (sameTrack) {
        // SAME TRACK: single combined write (metadata + all images = 1 Realtime event)
        const fullPayload = { ...metadataPayload };
        if (missingCachedBg.value && !bgImageUrl) fullPayload.bg_image_url = null;
        if (missingCachedWidget.value && !widgetArtUrl) fullPayload.widget_art_url = null;
        if (bgImageUrl) fullPayload.bg_image_url = bgImageUrl;
        if (widgetArtUrl) fullPayload.widget_art_url = widgetArtUrl;
        if (nextAlbumArtMedium) fullPayload.next_album_art_url = nextAlbumArtMedium;
        if (nextBgUrl) fullPayload.next_bg_image_url = nextBgUrl;
        if (nextWidgetUrl) fullPayload.next_widget_art_url = nextWidgetUrl;
        await supabase.from('sonos_now_playing').update(fullPayload).eq('id', rowId);
      } else {
        // NEW TRACK: Phase 1 already written, now write images (2nd Realtime event)
        const imageUpdate: Record<string, any> = {};
        if (bgImageUrl) imageUpdate.bg_image_url = bgImageUrl;
        if (widgetArtUrl) imageUpdate.widget_art_url = widgetArtUrl;
        if (nextAlbumArtMedium) imageUpdate.next_album_art_url = nextAlbumArtMedium;
        if (nextBgUrl) imageUpdate.next_bg_image_url = nextBgUrl;
        if (nextWidgetUrl) imageUpdate.next_widget_art_url = nextWidgetUrl;
        if (Object.keys(imageUpdate).length > 0) {
          await supabase.from('sonos_now_playing').update(imageUpdate).eq('id', rowId);
        }
      }

      // Cleanup unreferenced files after final write (non-blocking)
      cleanupUnreferencedBackgrounds(supabase, [bgImageUrl, widgetArtUrl, nextBgUrl, nextWidgetUrl]).catch(() => {});
    }

    const totalMs = Date.now() - startTime;
    const writeCount = sameTrack ? 1 : 2;
    const imgSkipped = sameTrack && !needCurrentImages ? ' [images cached]' : '';
    console.log(`[SonosSync] Done in ${totalMs}ms (${writeCount} write${writeCount > 1 ? 's' : ''})${imgSkipped} - ${currentTrackName || 'no track'} (bg: ${bgImageUrl ? 'yes' : 'no'}, next: ${nextTrackName || 'none'})`);

    return new Response(JSON.stringify({ ok: true, duration_ms: totalMs, writes: writeCount }), {
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
