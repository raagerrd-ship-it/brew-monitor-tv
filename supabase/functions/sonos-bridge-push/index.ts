import { createClient } from "npm:@supabase/supabase-js@2";
import type { BgSettings } from "../_shared/image-processing.ts";
import { resolveBackground, cleanupUnreferencedBackgrounds } from "../_shared/sonos-storage.ts";
import { resolveAlbumArt } from "../_shared/sonos-art.ts";

/** Decode common XML/HTML entities that UPnP metadata may contain */
function decodeXmlEntities(s: string | null | undefined): string | null {
  if (!s) return null;
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

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
      pushedAt,
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
      // Bridge self-registration fields
      groupId: bridgeGroupId,
      groupName: bridgeGroupName,
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
        .select('id, bg_blur, bg_brightness, bg_contrast, bg_saturation, bg_top_gradient_opacity, bg_top_gradient_height, selected_group_id')
        .order('created_at', { ascending: true })
        .limit(1)
        .single(),
      supabase.from('sonos_now_playing')
        .select('id, track_name, track_seq, position_ms, bg_image_url, next_bg_image_url, next_track_name, playback_state, album_art_url')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const settings = settingsResult.data;
    const existingRow = existingResult.data;
    const groupId = bridgeGroupId || settings?.selected_group_id || 'bridge';

    // Auto-register group from bridge if settings are missing or outdated
    if (bridgeGroupId && (!settings?.selected_group_id || settings.selected_group_id !== bridgeGroupId)) {
      const settingsUpdate: Record<string, any> = { selected_group_id: bridgeGroupId };
      if (bridgeGroupName) settingsUpdate.selected_group_name = bridgeGroupName;
      if (settings) {
        await supabase.from('sonos_settings').update(settingsUpdate).eq('id', (settings as any).id || settings);
      } else {
        await supabase.from('sonos_settings').insert({ ...settingsUpdate, show_on_dashboard: true });
      }
      console.log(`[BridgePush] Auto-registered group "${bridgeGroupName || bridgeGroupId}"`);
    }

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
    // Compensate for network latency using pushedAt timestamp
    const latencyMs = (typeof pushedAt === 'number' && pushedAt > 0) ? Math.max(0, Date.now() - pushedAt) : 0;
    const compensatedPosition = hasRealPosition ? positionMillis + latencyMs : 0;

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
      position_ms: compensatedPosition,
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
      // Clear bg on new track to prevent stale bg flash
      ...(sameTrack ? {} : {
        bg_image_url: null,
        next_bg_image_url: null,
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
    console.log(`[BridgePush] Phase 1 done in ${phase1Ms}ms — ${sameTrack ? 'same' : 'NEW'} track "${trackName}" bridgePos=${positionMillis ?? 'null'}ms +latency=${latencyMs}ms → written=${compensatedPosition}ms state=${playbackState} bridgeArt=${bridgeHasArt}`);

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

    // --- Phase 2: Resolve art + generate background ---
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
      const result = await resolveBackground(
        supabase, currentArtUrl, trackId, bgSettings, viewportW, viewportH, false, trackName
      );
      if (result.bgUrl) imageUpdate.bg_image_url = result.bgUrl;
    }

    // Next track background (skip for radio — next track metadata is unreliable)
    const isRadio = (mediaType ?? '').toLowerCase() === 'radio';
    if (nextTrackName && !isRadio) {
      try {
        let nextArtUrl: string | null = null;
        if (bridgeHasNextArt) {
          nextArtUrl = bustCache(nextAlbumArtUri);
        } else {
          const nextResolved = await resolveAlbumArt(nextAlbumArtUri || null, undefined, nextTrackName, nextArtistName);
          nextArtUrl = nextResolved.medium;
        }
        if (nextArtUrl) {
          if (!bridgeHasNextArt) imageUpdate.next_album_art_url = nextArtUrl;
          const nextResult = await resolveBackground(
            supabase, nextArtUrl, nextTrackName, bgSettings, viewportW, viewportH, false, nextTrackName
          );
          if (nextResult.bgUrl) imageUpdate.next_bg_image_url = nextResult.bgUrl;
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
        .select('bg_image_url, next_bg_image_url')
        .eq('id', rowId).single();
      if (row) {
        cleanupUnreferencedBackgrounds(supabase, [
          row.bg_image_url, row.next_bg_image_url,
        ]).catch(() => {});
      }
    }

    const totalMs = Date.now() - startTime;
    console.log(`[BridgePush] Phase 2 done in ${totalMs}ms — bg: ${!!imageUpdate.bg_image_url}`);

    return new Response(JSON.stringify({
      ok: true,
      phase: 2,
      duration_ms: totalMs,
      phase1_ms: phase1Ms,
      has_bg: !!imageUpdate.bg_image_url,
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
