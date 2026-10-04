import { createClient } from "npm:@supabase/supabase-js@2";
import type { BgSettings } from "../_shared/image-processing.ts";
import { resolveBackground, cleanupUnreferencedBackgrounds, uploadBackground } from "../_shared/sonos-storage.ts";
import { simpleHash, artFingerprint, base64ToBytes } from "../_shared/image-processing.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

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
      // Raw image bytes (base64) uploaded by the bridge
      albumArtBase64,
      nextAlbumArtBase64,
      earlySwitch,
      // Bridge self-registration fields
      groupId: bridgeGroupId,
      groupName: bridgeGroupName,
    } = body;

    // Treat null trackName (e.g. TV/SPDIF input) as IDLE
    const isNonMusicInput = !trackName && playbackState !== 'PLAYBACK_STATE_IDLE';
    const effectiveState = isNonMusicInput ? 'PLAYBACK_STATE_IDLE' : playbackState;

    // Fetch settings + existing row in parallel
    const [settingsResult, existingResult] = await Promise.all([
      supabase.from('sonos_settings')
        .select('id, bg_blur, bg_brightness, bg_contrast, bg_saturation, bg_vignette, bg_top_gradient_opacity, bg_top_gradient_height, selected_group_id')
        .order('created_at', { ascending: true })
        .limit(1)
        .single(),
      supabase.from('sonos_now_playing')
        .select('id, track_name, track_seq, position_ms, bg_image_url, next_bg_image_url, accent_color, next_accent_color, next_album_art_url, next_track_name, playback_state, album_art_url, updated_at, position_stale_count')
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
      brightness: settings?.bg_brightness ?? 70,
      contrast: settings?.bg_contrast ?? 1.0,
      saturation: settings?.bg_saturation ?? 0.8,
      vignette: settings?.bg_vignette ?? 0.35,
      topGradientOpacity: settings?.bg_top_gradient_opacity ?? 0.45,
      topGradientHeight: settings?.bg_top_gradient_height ?? 85,
    };

    // Handle IDLE
    if (effectiveState === 'PLAYBACK_STATE_IDLE') {
      if (existingRow) {
        await supabase.from('sonos_now_playing').update({
          playback_state: 'PLAYBACK_STATE_IDLE',
          position_ms: 0,
        }).eq('id', existingRow.id);
      }
      const duration = Date.now() - startTime;
      console.log(`[BridgePush] IDLE in ${duration}ms${isNonMusicInput ? ' (non-music input)' : ''}`);
      return new Response(JSON.stringify({
        ok: true, idle: true, non_music: isNonMusicInput, duration_ms: duration,
        need_album_art: false,
        need_next_album_art: false,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const decodedTrackName = decodeXmlEntities(trackName);
    const sameTrack = existingRow?.track_name === decodedTrackName;
    const newTrackSeq = sameTrack
      ? (existingRow?.track_seq ?? 0)
      : ((existingRow?.track_seq ?? 0) + 1);

    // --- Stale-position detection: bridge reports PLAYING but position is frozen ---
    // Track consecutive pushes where position doesn't change. If ≥2 in a row → force PAUSED.
    let effectivePlaybackState = effectiveState || 'PLAYBACK_STATE_PLAYING';
    let newStaleCount = 0;
    const positionFrozen = (
      sameTrack &&
      effectivePlaybackState === 'PLAYBACK_STATE_PLAYING' &&
      existingRow?.position_ms != null &&
      typeof positionMillis === 'number' &&
      positionMillis >= 3000 && // låtstart: bryggan rapporterar 1 ms några gånger — inte paus
      Math.abs(positionMillis - existingRow.position_ms) < 2000 &&
      existingRow.playback_state === 'PLAYBACK_STATE_PLAYING'
    );
    if (positionFrozen) {
      newStaleCount = (existingRow.position_stale_count ?? 0) + 1;
      if (newStaleCount >= 2) {
        effectivePlaybackState = 'PLAYBACK_STATE_PAUSED';
        console.log(`[BridgePush] Stale position detected: ${positionMillis}ms frozen for ${newStaleCount} consecutive pushes → forcing PAUSED`);
      }
    }

    // Bridge sends the image itself (base64) on every state push — only upload when we
    // actually need it (new track, or missing art/background), never on repeat pushes.
    // Avkoda base64 en gång — samma bytes används för uppladdning och bakgrund
    const artBytes = base64ToBytes(albumArtBase64);
    const nextArtBytes = base64ToBytes(nextAlbumArtBase64);
    const artHash = artFingerprint(artBytes);
    const nextArtHash = artFingerprint(nextArtBytes);
    // The background file name starts with hash(trackName|artHash), so a new cover = new name
    const expectedBgHash = artHash ? simpleHash(`${trackName || ''}|${artHash}`) : null;
    const expectedNextBgHash = nextArtHash && nextTrackName ? simpleHash(`${nextTrackName}|${nextArtHash}`) : null;
    // Låtbyte till kvitterad nästa-låt: främja lagrad nästa-bakgrund direkt (ingen ny uppladdning)
    const promoteNext = !sameTrack && !!existingRow?.next_bg_image_url
      && existingRow.next_track_name === decodedTrackName
      && (!expectedBgHash || existingRow.next_bg_image_url.includes(expectedBgHash));
    // 3 s-försprång: bryggan flaggar earlySwitch när ≤3 s återstår → visa nästa bakgrund direkt
    const alreadyEarly = sameTrack && !!existingRow?.next_bg_image_url && existingRow.bg_image_url === existingRow.next_bg_image_url;
    const doEarly = sameTrack && earlySwitch === true && !!existingRow?.next_bg_image_url && !alreadyEarly;
    const needsCurrentArt = (promoteNext || alreadyEarly || doEarly) ? false : !sameTrack || !existingRow?.bg_image_url || !existingRow?.album_art_url
      || (!!expectedBgHash && !existingRow.bg_image_url.includes(expectedBgHash));
    // Radio has no reliable next track — never ask the bridge for that image
    const isRadio = (mediaType ?? '').toLowerCase() === 'radio';
    const wantsNextArt = !!nextTrackName && !isRadio;
    const needsNextArt = wantsNextArt && (
      !sameTrack || !existingRow?.next_bg_image_url
      || (!!expectedNextBgHash && !existingRow.next_bg_image_url.includes(expectedNextBgHash))
    );

    const useArt = needsCurrentArt && !!artBytes;
    const useNextArt = needsNextArt && !!nextArtBytes;
    const [uploadedArtUrl, uploadedNextArtUrl] = await Promise.all([
      useArt ? uploadBackground(supabase, artBytes!, 'bridge-current.jpg') : Promise.resolve(null),
      useNextArt ? uploadBackground(supabase, nextArtBytes!, 'bridge-next.jpg') : Promise.resolve(null),
    ]);

    const bridgeArtUrl = uploadedArtUrl ?? (isStorageUrl(albumArtUri) ? bustCache(albumArtUri) : null);
    const bridgeNextArtUrl = uploadedNextArtUrl ?? (isStorageUrl(nextAlbumArtUri) ? bustCache(nextAlbumArtUri) : null);
    const bridgeHasArt = !!bridgeArtUrl;
    const hasRealPosition = typeof positionMillis === 'number' && positionMillis > 0;
    // Compensate for network latency using pushedAt timestamp
    const latencyMs = (typeof pushedAt === 'number' && pushedAt > 0) ? Math.max(0, Date.now() - pushedAt) : 0;
    const compensatedPosition = hasRealPosition ? positionMillis + latencyMs : 0;

    // --- Phase 1: Write metadata immediately ---
    const metadataPayload: Record<string, any> = {
      group_id: groupId,
      track_name: decodeXmlEntities(trackName),
      artist_name: decodeXmlEntities(artistName),
      album_name: decodeXmlEntities(albumName),
      album_art_url_small: albumArtUri || bridgeArtUrl || null,
      next_track_name: decodeXmlEntities(nextTrackName),
      next_artist_name: decodeXmlEntities(nextArtistName),
      playback_state: effectivePlaybackState,
      duration_ms: durationMillis || null,
      position_ms: compensatedPosition,
      track_seq: newTrackSeq,
      position_stale_count: newStaleCount,
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
      ...(bridgeArtUrl ? { album_art_url: bridgeArtUrl } : {}),
      ...(bridgeNextArtUrl ? { next_album_art_url: bridgeNextArtUrl } : {}),
      // Extended UPnP metadata
      current_uri: currentURI ?? null,
      next_av_transport_uri: nextAVTransportURI ?? null,
      play_medium: playMedium ?? null,
      stream_content: decodeXmlEntities(streamContent),
      radio_show_md: decodeXmlEntities(radioShowMd),
      original_track_number: originalTrackNumber ?? null,
      protocol_info: protocolInfo ?? null,
      // Clear bg on new track to prevent stale bg flash
      ...(sameTrack ? (doEarly ? { bg_image_url: existingRow.next_bg_image_url, accent_color: existingRow.next_accent_color } : {}) : promoteNext ? {
        bg_image_url: existingRow.next_bg_image_url,
        accent_color: existingRow.next_accent_color,
        ...(existingRow.next_album_art_url && !bridgeArtUrl ? { album_art_url: existingRow.next_album_art_url } : {}),
        next_bg_image_url: null,
        next_accent_color: null,
      } : {
        bg_image_url: null,
        accent_color: null,
        next_bg_image_url: null,
        next_accent_color: null,
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
    const needsBg = needsCurrentArt;
    // Hoppa över Phase 2 bara om inget nytt laddades upp — annars måste nästa bakgrund genereras
    if ((sameTrack || promoteNext) && !needsBg && !uploadedNextArtUrl) {
      return new Response(JSON.stringify({
        ok: true, phase: 1, same_track: sameTrack, promoted_next: promoteNext, early_switch: doEarly || alreadyEarly, duration_ms: phase1Ms,
        // ACK: cloud already has the art for this track — bridge can omit the base64 image
        need_album_art: false,
        need_next_album_art: needsNextArt && !uploadedNextArtUrl,
        ack_track: decodedTrackName,
        ack_next_track: decodeXmlEntities(nextTrackName),
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (sameTrack && needsBg) {
      console.log(`[BridgePush] Same track but missing bg — running Phase 2`);
    }

    // --- Phase 2: Generate background from the bridge-provided image ---
    const currentArtUrl = bridgeArtUrl;
    const phase2Start = Date.now();

    const imageUpdate: Record<string, any> = {};

    // Current and next backgrounds are independent — resolve in parallel
    const [result, nextResult] = await Promise.all([
      currentArtUrl
        ? resolveBackground(
            // Cache key follows the image itself — radio keeps one track name across many covers
            supabase, (uploadedArtUrl && artBytes) || currentArtUrl, `${trackName || ''}|${artHash ?? currentArtUrl}`, bgSettings, viewportW, viewportH, false, trackName
          )
        : Promise.resolve(null),
      // Next track background (skip for radio — next track metadata is unreliable)
      wantsNextArt && bridgeNextArtUrl
        ? resolveBackground(
            supabase, (uploadedNextArtUrl && nextArtBytes) || bridgeNextArtUrl, `${nextTrackName}|${nextArtHash ?? bridgeNextArtUrl}`,
            bgSettings, viewportW, viewportH, false, nextTrackName
          ).catch((e) => { console.error(`[BridgePush] Next track images error:`, e); return null; })
        : Promise.resolve(null),
    ]);
    if (result?.bgUrl) {
      imageUpdate.bg_image_url = result.bgUrl;
      imageUpdate.accent_color = result.accentColor;
      imageUpdate.bg_cached = result.cached;
      imageUpdate.bg_generation_ms = result.generationMs;
    }
    if (nextResult?.bgUrl) {
      imageUpdate.next_bg_image_url = nextResult.bgUrl;
      imageUpdate.next_accent_color = nextResult.accentColor;
      imageUpdate.next_bg_cached = nextResult.cached;
      imageUpdate.next_bg_generation_ms = nextResult.generationMs;
    }

    // Phase 2 write
    if (rowId && Object.keys(imageUpdate).length > 0) {
      const { data: row } = await supabase.from('sonos_now_playing')
        .update(imageUpdate).eq('id', rowId)
        .select('bg_image_url, next_bg_image_url').single();

      // Städa gamla bakgrunder efter svaret — fördröjer inte bryggan
      if (row) {
        EdgeRuntime.waitUntil(cleanupUnreferencedBackgrounds(supabase, [
          row.bg_image_url, row.next_bg_image_url,
        ]).catch(() => {}));
      }
    }

    const totalMs = Date.now() - startTime;
    console.log(`[BridgePush] Phase 2 done in ${totalMs}ms (art branch ${totalMs - phase2Start + startTime}ms) — bg: ${!!imageUpdate.bg_image_url}`);

    return new Response(JSON.stringify({
      ok: true,
      phase: 2,
      duration_ms: totalMs,
      phase1_ms: phase1Ms,
      has_bg: !!imageUpdate.bg_image_url,
      bridge_art: bridgeHasArt,
      // ACK: false = cloud has what it needs, bridge can omit the base64 image
      need_album_art: !(imageUpdate.bg_image_url || existingRow?.bg_image_url),
      need_next_album_art: wantsNextArt
        && !(imageUpdate.next_bg_image_url || uploadedNextArtUrl || existingRow?.next_bg_image_url),
      ack_track: decodedTrackName,
      ack_next_track: decodeXmlEntities(nextTrackName),
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
