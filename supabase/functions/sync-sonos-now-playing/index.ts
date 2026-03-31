
import { createClient } from "npm:@supabase/supabase-js@2";
import type { BgSettings } from "../_shared/image-processing.ts";
import { resolveBackground, cleanupUnreferencedBackgrounds, storageObjectExistsByPublicUrl } from "../_shared/sonos-storage.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * sync-sonos-now-playing — pause timeout + image processing.
 * All metadata is pushed by Cast Away (UPnP bridge) via sonos-bridge-push.
 * This function is called by cron and handles:
 * 1. Pause → IDLE timeout (5 min stale pause detection)
 * 2. bg_only mode (regenerate background images on demand)
 * 3. Normal mode (generate missing background images)
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
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
    // Fetch settings + existing now-playing row in parallel
    const [settingsResult, npResult] = await Promise.all([
      supabase.from('sonos_settings')
        .select('bg_blur, bg_brightness, bg_contrast, bg_saturation, bg_top_gradient_opacity, bg_top_gradient_height')
        .order('created_at', { ascending: true })
        .limit(1)
        .single(),
      supabase.from('sonos_now_playing')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
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

    const existingRow = npResult.data;

    if (!existingRow) {
      const duration = Date.now() - startTime;
      console.log(`[SonosSync] No row → skip in ${duration}ms`);
      return new Response(JSON.stringify({ ok: true, skipped: true, duration_ms: duration }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // --- Server-side pause timeout (5 min) ---
    const PAUSE_TIMEOUT_MS = 5 * 60 * 1000;
    const playbackState = existingRow.playback_state;
    const msSinceUpdate = existingRow.updated_at
      ? Date.now() - new Date(existingRow.updated_at).getTime()
      : Infinity;

    if (playbackState === 'PLAYBACK_STATE_IDLE') {
      const duration = Date.now() - startTime;
      console.log(`[SonosSync] Already IDLE → skip in ${duration}ms`);
      return new Response(JSON.stringify({ ok: true, idle: true, duration_ms: duration }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (playbackState === 'PLAYBACK_STATE_PAUSED' && msSinceUpdate > PAUSE_TIMEOUT_MS) {
      await supabase.from('sonos_now_playing').update({
        playback_state: 'PLAYBACK_STATE_IDLE',
        position_ms: 0,
      }).eq('id', existingRow.id);

      cleanupUnreferencedBackgrounds(supabase, []).catch(() => {});

      const duration = Date.now() - startTime;
      console.log(`[SonosSync] Stale pause (${Math.round(msSinceUpdate / 1000)}s) → IDLE in ${duration}ms`);
      return new Response(JSON.stringify({ ok: true, idle: true, duration_ms: duration }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (playbackState === 'PLAYBACK_STATE_PAUSED' && msSinceUpdate <= PAUSE_TIMEOUT_MS) {
      const duration = Date.now() - startTime;
      console.log(`[SonosSync] Still paused (${Math.round(msSinceUpdate / 1000)}s) → skip in ${duration}ms`);
      return new Response(JSON.stringify({ ok: true, paused: true, duration_ms: duration }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // --- No album art → nothing to process ---
    if (!existingRow.album_art_url) {
      const duration = Date.now() - startTime;
      console.log(`[SonosSync] No album art → skip in ${duration}ms`);
      return new Response(JSON.stringify({ ok: true, skipped: true, duration_ms: duration }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const artUrl = existingRow.album_art_url;
    const trackName = existingRow.track_name || '';

    // --- bg_only mode: only regenerate background for existing track ---
    if (bgOnly) {
      const result = await resolveBackground(supabase, artUrl, trackName, bgSettings, viewportW, viewportH, true, trackName);
      if (result.bgUrl) {
        const updateFields: Record<string, any> = { updated_at: new Date().toISOString(), bg_image_url: result.bgUrl };
        await supabase.from('sonos_now_playing').update(updateFields).eq('id', existingRow.id);
        const { data: row } = await supabase.from('sonos_now_playing').select('bg_image_url, next_bg_image_url').eq('id', existingRow.id).single();
        if (row) cleanupUnreferencedBackgrounds(supabase, [row.bg_image_url, row.next_bg_image_url]).catch(() => {});
      }
      const duration = Date.now() - startTime;
      console.log(`[SonosSync] bg_only: regenerated for "${trackName}" in ${duration}ms`);
      return new Response(JSON.stringify({ ok: true, bg_only: true, duration_ms: duration }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // --- Normal mode: generate missing background for current track ---
    let bgImageUrl = existingRow.bg_image_url || null;

    // Verify cached URL still exists in storage
    if (bgImageUrl) {
      const bgExists = await storageObjectExistsByPublicUrl(supabase, bgImageUrl);
      if (!bgExists) bgImageUrl = null;
    }

    if (!bgImageUrl) {
      const result = await resolveBackground(supabase, artUrl, trackName, bgSettings, viewportW, viewportH, false, trackName);
      if (result.bgUrl) bgImageUrl = result.bgUrl;

      if (result.bgUrl) {
        await supabase.from('sonos_now_playing').update({ bg_image_url: result.bgUrl }).eq('id', existingRow.id);
      }

      cleanupUnreferencedBackgrounds(supabase, [bgImageUrl, existingRow.next_bg_image_url]).catch(() => {});
    }

    const totalMs = Date.now() - startTime;
    console.log(`[SonosSync] Done in ${totalMs}ms - "${trackName}" (bg ${bgImageUrl ? 'ok' : 'missing'})`);

    return new Response(JSON.stringify({ ok: true, duration_ms: totalMs }), {
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
