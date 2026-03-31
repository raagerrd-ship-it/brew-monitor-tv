
import { createClient } from "npm:@supabase/supabase-js@2";
import type { BgSettings } from "../_shared/image-processing.ts";
import { resolveBackgroundAndWidget, cleanupUnreferencedBackgrounds, storageObjectExistsByPublicUrl } from "../_shared/sonos-storage.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * sync-sonos-now-playing — image processing only.
 * All metadata is pushed by Cast Away (UPnP bridge) via sonos-bridge-push.
 * This function reads the existing DB row and generates/regenerates
 * background + widget images when missing.
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
        .limit(1)
        .single(),
      supabase.from('sonos_now_playing')
        .select('*')
        .limit(1)
        .single(),
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

    if (!existingRow || !existingRow.album_art_url) {
      const duration = Date.now() - startTime;
      console.log(`[SonosSync] No row or album art → skip in ${duration}ms`);
      return new Response(JSON.stringify({ ok: true, skipped: true, duration_ms: duration }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const artUrl = existingRow.album_art_url;
    const trackName = existingRow.track_name || '';

    // --- bg_only mode: only regenerate background for existing track ---
    if (bgOnly) {
      const result = await resolveBackgroundAndWidget(supabase, artUrl, trackName, bgSettings, viewportW, viewportH, null, true, trackName);
      if (result.bgUrl || result.widgetUrl) {
        const updateFields: Record<string, any> = { updated_at: new Date().toISOString() };
        if (result.bgUrl) updateFields.bg_image_url = result.bgUrl;
        if (result.widgetUrl) updateFields.widget_art_url = result.widgetUrl;
        await supabase.from('sonos_now_playing').update(updateFields).eq('id', existingRow.id);
        // Cleanup
        const { data: row } = await supabase.from('sonos_now_playing').select('bg_image_url, widget_art_url, next_bg_image_url, next_widget_art_url').eq('id', existingRow.id).single();
        if (row) cleanupUnreferencedBackgrounds(supabase, [row.bg_image_url, row.widget_art_url, row.next_bg_image_url, row.next_widget_art_url]).catch(() => {});
      }
      const duration = Date.now() - startTime;
      console.log(`[SonosSync] bg_only: regenerated for "${trackName}" in ${duration}ms`);
      return new Response(JSON.stringify({ ok: true, bg_only: true, duration_ms: duration }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // --- Normal mode: generate missing images for current track ---
    let bgImageUrl = existingRow.bg_image_url || null;
    let widgetArtUrl = existingRow.widget_art_url || null;

    // Verify cached URLs still exist in storage
    if (bgImageUrl || widgetArtUrl) {
      const [bgExists, widgetExists] = await Promise.all([
        bgImageUrl ? storageObjectExistsByPublicUrl(supabase, bgImageUrl) : Promise.resolve(false),
        widgetArtUrl ? storageObjectExistsByPublicUrl(supabase, widgetArtUrl) : Promise.resolve(false),
      ]);
      if (!bgExists) bgImageUrl = null;
      if (!widgetExists) widgetArtUrl = null;
    }

    const needImages = !bgImageUrl || !widgetArtUrl;

    if (needImages) {
      const result = await resolveBackgroundAndWidget(supabase, artUrl, trackName, bgSettings, viewportW, viewportH, widgetArtUrl, false, trackName);
      if (result.bgUrl) bgImageUrl = result.bgUrl;
      if (result.widgetUrl) widgetArtUrl = result.widgetUrl;

      const updateFields: Record<string, any> = {};
      if (result.bgUrl) updateFields.bg_image_url = result.bgUrl;
      if (result.widgetUrl) updateFields.widget_art_url = result.widgetUrl;
      if (Object.keys(updateFields).length > 0) {
        await supabase.from('sonos_now_playing').update(updateFields).eq('id', existingRow.id);
      }

      // Cleanup unreferenced files (non-blocking)
      cleanupUnreferencedBackgrounds(supabase, [bgImageUrl, widgetArtUrl, existingRow.next_bg_image_url, existingRow.next_widget_art_url]).catch(() => {});
    }

    const totalMs = Date.now() - startTime;
    console.log(`[SonosSync] Done in ${totalMs}ms - "${trackName}" (images ${needImages ? 'generated' : 'cached'})`);

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
