import { createClient } from "npm:@supabase/supabase-js@2";
import type { BgSettings } from "../_shared/image-processing.ts";
import { resolveBackgroundAndWidget, cleanupUnreferencedBackgrounds } from "../_shared/sonos-storage.ts";
import { resolveAlbumArt } from "../_shared/sonos-art.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-bridge-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/** Check if URL points to our own storage bucket */
function isStorageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.includes('/storage/v1/object/public/sonos-backgrounds/');
}

/** Append a cache-buster timestamp to a storage URL */
function bustCache(url: string): string {
  const base = url.split('?')[0];
  return `${base}?v=${Date.now()}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  // Validate bridge secret
  const bridgeSecret = req.headers.get('x-bridge-secret');
  const expectedSecret = Deno.env.get('SONOS_BRIDGE_SECRET');
  if (!expectedSecret || bridgeSecret !== expectedSecret) {
    return new Response(JSON.stringify({ ok: false, reason: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  // Fixed resolution for background images (matches locked 720p layout)
  const viewportW = 1280;
  const viewportH = 720;

  try {
    const body = await req.json();
    const {
      trackName,
      artistName,
      albumName,
      albumArtUri,
      nextTrackName,
      nextArtistName,
      nextAlbumArtUri,
      playbackState,
      positionMillis,
      durationMillis,
      volume,
      mute,
      bass,
      treble,
      loudness,
      crossfade,
      mediaType,
      trackNumber,
      trackURI,
      nrTracks,
      currentURI,
      nextAVTransportURI,
      playMedium,
      streamContent,
      radioShowMd,
      originalTrackNumber,
      protocolInfo,
    } = body;

    if (!trackName && playbackState !== 'PLAYBACK_STATE_IDLE') {
      return new Response(JSON.stringify({ ok: false, reason: 'no_track_name' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch settings + existing row in parallel
    const [settingsResult, existingResult] = await Promise.all([
      supabase.from('sonos_settings')
        .select('bg_blur, bg_brightness, bg_contrast, bg_saturation, bg_top_gradient_opacity, bg_top_gradient_height, selected_group_id')
        .limit(1)
        .single(),
      supabase.from('sonos_now_playing')
        .select('id, track_name, track_seq, position_ms, bg_image_url, widget_art_url, next_bg_image_url, next_widget_art_url, next_track_name, playback_state, album_art_url')
        .limit(1)
        .single(),
    ]);

    const settings = settingsResult.data;
    const existingRow = existingResult.data;
    const groupId = settings?.selected_group_id || 'bridge';

    const bgSettings: BgSettings = {
      blur: settings?.bg_blur ?? 40,
      brightness: settings?.bg_brightness ?? 90,
      contrast: settings?.bg_contrast ?? 1.0,
      saturation: settings?.bg_saturation ?? 1.0,
      topGradientOpacity: settings?.bg_top_gradient_opacity ?? 0.45,
      topGradientHeight: settings?.bg_top_gradient_height ?? 85,
    };

    // Handle IDLE
    if (playbackState === 'PLAYBACK_STATE_IDLE') {
      if (existingRow) {
        await supabase.from('sonos_now_playing').update({
          playback_state: 'PLAYBACK_STATE_IDLE',
          position_ms: 0,
        }).eq('id', existingRow.id);
      }
      const duration = Date.now() - startTime;
      console.log(`[BridgePush] IDLE in ${duration}ms`);
      return new Response(JSON.stringify({ ok: true, idle: true, duration_ms: duration }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sameTrack = existingRow?.track_name === trackName;
    const newTrackSeq = sameTrack
      ? (existingRow?.track_seq ?? 0)
      : ((existingRow?.track_seq ?? 0) + 1);

    const bridgeHasArt = isStorageUrl(albumArtUri);
    const bridgeHasNextArt = isStorageUrl(nextAlbumArtUri);
    const hasRealPosition = typeof positionMillis === 'number' && positionMillis > 0;
    // Skip writing position_ms entirely when bridge sends 0 for same track
    const skipPositionWrite = sameTrack && !hasRealPosition;

    // --- Phase 1: Write metadata immediately ---
    const metadataPayload: Record<string, any> = {
      group_id: groupId,
      track_name: trackName,
      artist_name: artistName || null,
      album_name: albumName || null,
      album_art_url_small: albumArtUri || null,
      next_track_name: nextTrackName || null,
      next_artist_name: nextArtistName || null,
      playback_state: playbackState || 'PLAYBACK_STATE_PLAYING',
      duration_ms: durationMillis || null,
      position_ms: preserveExistingPosition
        ? existingRow.position_ms
        : (hasExplicitPosition ? positionMillis : 0),
      track_seq: newTrackSeq,
      // Bridge-provided metadata columns
      volume: volume ?? null,
      mute: mute ?? null,
      bass: bass ?? null,
      treble: treble ?? null,
      loudness: loudness ?? null,
      crossfade: crossfade ?? null,
      media_type: mediaType ?? null,
      track_number: trackNumber ?? null,
      track_uri: trackURI ?? null,
      nr_tracks: nrTracks ?? null,
      // If bridge uploaded art, set album_art_url immediately (cache-busted)
      ...(bridgeHasArt ? { album_art_url: bustCache(albumArtUri) } : {}),
      ...(bridgeHasNextArt ? { next_album_art_url: bustCache(nextAlbumArtUri) } : {}),
      // Extended UPnP metadata
      current_uri: currentURI ?? null,
      next_av_transport_uri: nextAVTransportURI ?? null,
      play_medium: playMedium ?? null,
      stream_content: streamContent ?? null,
      radio_show_md: radioShowMd ?? null,
      original_track_number: originalTrackNumber ?? null,
      protocol_info: protocolInfo ?? null,
      // Clear images on new track to prevent stale bg flash
      ...(sameTrack ? {} : {
        bg_image_url: null,
        widget_art_url: null,
        next_bg_image_url: null,
        next_widget_art_url: null,
      }),
    };

    let rowId: string;
    if (existingRow) {
      await supabase.from('sonos_now_playing').update(metadataPayload).eq('id', existingRow.id);
      rowId = existingRow.id;
    } else {
      const { data: inserted } = await supabase.from('sonos_now_playing').insert(metadataPayload).select('id').single();
      rowId = inserted?.id;
    }

    const phase1Ms = Date.now() - startTime;
    const writtenPos = metadataPayload.position_ms;
    console.log(`[BridgePush] Phase 1 done in ${phase1Ms}ms — ${sameTrack ? 'same' : 'NEW'} track "${trackName}" pos=${positionMillis}→${writtenPos}ms state=${playbackState} bridgeArt=${bridgeHasArt}`);

    // If same track AND background already exists, just a position/state update — done
    const needsBg = !existingRow?.bg_image_url;
    if (sameTrack && !needsBg) {
      return new Response(JSON.stringify({ ok: true, phase: 1, same_track: true, duration_ms: phase1Ms }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (sameTrack && needsBg) {
      console.log(`[BridgePush] Same track but missing bg — running Phase 2`);
    }

    // --- Phase 2: Resolve art + generate background/widget ---
    // If bridge uploaded art, use it directly; otherwise fall back to resolveAlbumArt
    let currentArtUrl: string | null = null;
    if (bridgeHasArt) {
      currentArtUrl = bustCache(albumArtUri);
    } else {
      const resolved = await resolveAlbumArt(albumArtUri || null, undefined, trackName, artistName);
      currentArtUrl = resolved.medium;
    }

    const imageUpdate: Record<string, any> = {};

    if (currentArtUrl) {
      if (!bridgeHasArt) imageUpdate.album_art_url = currentArtUrl;
      const trackId = trackName || '';
      const result = await resolveBackgroundAndWidget(
        supabase, currentArtUrl, trackId, bgSettings, viewportW, viewportH, null, false, trackName
      );
      if (result.bgUrl) imageUpdate.bg_image_url = result.bgUrl;
      if (result.widgetUrl) imageUpdate.widget_art_url = result.widgetUrl;
    }

    // Next track images (skip for radio — next track metadata is unreliable)
    const isRadio = (mediaType ?? '').toLowerCase() === 'radio';
    if (nextTrackName && !isRadio) {
      try {
        let nextArtUrl: string | null = null;
        if (bridgeHasNextArt) {
          nextArtUrl = bustCache(nextAlbumArtUri);
        } else {
          // Resolve art even if nextAlbumArtUri is missing — resolveAlbumArt will fall back to Spotify search
          const nextResolved = await resolveAlbumArt(nextAlbumArtUri || null, undefined, nextTrackName, nextArtistName);
          nextArtUrl = nextResolved.medium;
        }
        if (nextArtUrl) {
          if (!bridgeHasNextArt) imageUpdate.next_album_art_url = nextArtUrl;
          const nextResult = await resolveBackgroundAndWidget(
            supabase, nextArtUrl, nextTrackName, bgSettings, viewportW, viewportH, null, false, nextTrackName
          );
          if (nextResult.bgUrl) imageUpdate.next_bg_image_url = nextResult.bgUrl;
          if (nextResult.widgetUrl) imageUpdate.next_widget_art_url = nextResult.widgetUrl;
        }
      } catch (e) {
        console.error(`[BridgePush] Next track images error:`, e);
      }
    }

    // Phase 2 write
    if (rowId && Object.keys(imageUpdate).length > 0) {
      await supabase.from('sonos_now_playing').update(imageUpdate).eq('id', rowId);

      // Cleanup old backgrounds
      const { data: row } = await supabase.from('sonos_now_playing')
        .select('bg_image_url, widget_art_url, next_bg_image_url, next_widget_art_url')
        .eq('id', rowId).single();
      if (row) {
        cleanupUnreferencedBackgrounds(supabase, [
          row.bg_image_url, row.widget_art_url, row.next_bg_image_url, row.next_widget_art_url,
        ]).catch(() => {});
      }
    }

    const totalMs = Date.now() - startTime;
    console.log(`[BridgePush] Phase 2 done in ${totalMs}ms — bg: ${!!imageUpdate.bg_image_url}, widget: ${!!imageUpdate.widget_art_url}`);

    return new Response(JSON.stringify({
      ok: true,
      phase: 2,
      duration_ms: totalMs,
      phase1_ms: phase1Ms,
      has_bg: !!imageUpdate.bg_image_url,
      has_widget: !!imageUpdate.widget_art_url,
      bridge_art: bridgeHasArt,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    console.error(`[BridgePush] Error:`, e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
