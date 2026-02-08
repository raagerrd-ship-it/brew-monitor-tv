import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { decode as decodeJpeg, encode as encodeJpeg } from "npm:jpeg-js@0.4.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SONOS_API_URL = 'https://api.ws.sonos.com/control/api/v1';

// Cache for oEmbed results (lives for duration of edge function instance)
const oEmbedCache = new Map<string, string>();

function extractSpotifyTrackId(trackUri: string | undefined): string | null {
  if (!trackUri) return null;
  const match = trackUri.match(/spotify(?:%3a|:)track(?:%3a|:)([a-zA-Z0-9]+)/i);
  return match ? match[1] : null;
}

// Get album art via Spotify's public oEmbed endpoint (no API key needed)
async function getAlbumArtViaOEmbed(trackId: string): Promise<{ medium: string | null; small: string | null }> {
  const cached = oEmbedCache.get(trackId);
  if (cached) return { medium: cached, small: null };

  try {
    const response = await fetch(
      `https://open.spotify.com/oembed?url=https://open.spotify.com/track/${trackId}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!response.ok) return { medium: null, small: null };
    const data = await response.json();
    const thumbUrl = data.thumbnail_url || null;
    if (thumbUrl) {
      oEmbedCache.set(trackId, thumbUrl);
    }
    return { medium: thumbUrl, small: null };
  } catch {
    return { medium: null, small: null };
  }
}

// Simple hash for track identification in filenames
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// Check if URL is a private/local address that can't be fetched externally
function isPrivateUrl(url: string): boolean {
  return /192\.168\.|10\.\d|172\.(1[6-9]|2\d|3[01])\.|localhost|127\.0\.0\.1|getaa/.test(url);
}

// ---- Image Processing Utilities ----

interface BgSettings {
  blur: number;
  brightness: number;
  contrast: number;
  saturation: number;
  topGradientOpacity: number;
  topGradientHeight: number;
}

// Bilinear resize of RGBA pixel data
function resizeBilinear(
  src: Uint8Array, srcW: number, srcH: number,
  dstW: number, dstH: number
): Uint8Array {
  const dst = new Uint8Array(dstW * dstH * 4);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;

  for (let y = 0; y < dstH; y++) {
    const srcY = y * yRatio;
    const y0 = Math.floor(srcY);
    const y1 = Math.min(y0 + 1, srcH - 1);
    const yFrac = srcY - y0;

    for (let x = 0; x < dstW; x++) {
      const srcX = x * xRatio;
      const x0 = Math.floor(srcX);
      const x1 = Math.min(x0 + 1, srcW - 1);
      const xFrac = srcX - x0;

      const dstIdx = (y * dstW + x) * 4;
      const i00 = (y0 * srcW + x0) * 4;
      const i10 = (y0 * srcW + x1) * 4;
      const i01 = (y1 * srcW + x0) * 4;
      const i11 = (y1 * srcW + x1) * 4;

      for (let c = 0; c < 4; c++) {
        const top = src[i00 + c] + (src[i10 + c] - src[i00 + c]) * xFrac;
        const bot = src[i01 + c] + (src[i11 + c] - src[i01 + c]) * xFrac;
        dst[dstIdx + c] = Math.round(top + (bot - top) * yFrac);
      }
    }
  }
  return dst;
}

// Apply blur via downscale-upscale trick
function applyBlur(pixels: Uint8Array, w: number, h: number, blur: number): Uint8Array {
  if (blur <= 0) return pixels;
  // Map blur (0-200) to downsample factor
  const factor = Math.max(2, Math.min(80, Math.round(blur / 2.5)));
  const smallW = Math.max(4, Math.round(w / factor));
  const smallH = Math.max(4, Math.round(h / factor));
  const small = resizeBilinear(pixels, w, h, smallW, smallH);
  return resizeBilinear(small, smallW, smallH, w, h);
}

// Apply brightness, contrast, saturation adjustments in-place
function applyColorAdjustments(
  pixels: Uint8Array, w: number, h: number,
  brightness: number, contrast: number, saturation: number,
): void {
  const len = w * h * 4;
  for (let i = 0; i < len; i += 4) {
    let r = pixels[i];
    let g = pixels[i + 1];
    let b = pixels[i + 2];

    // Brightness: scale toward target brightness level
    r = r * brightness;
    g = g * brightness;
    b = b * brightness;

    // Contrast: adjust around midpoint (128)
    r = ((r - 128) * contrast) + 128;
    g = ((g - 128) * contrast) + 128;
    b = ((b - 128) * contrast) + 128;

    // Saturation: blend with luminance
    if (saturation !== 1.0) {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      r = lum + (r - lum) * saturation;
      g = lum + (g - lum) * saturation;
      b = lum + (b - lum) * saturation;
    }

    pixels[i] = Math.max(0, Math.min(255, Math.round(r)));
    pixels[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
    pixels[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
  }
}

// Apply dark gradient at the top of the image
function applyTopGradient(
  pixels: Uint8Array, w: number, h: number,
  opacity: number, gradientHeight: number,
): void {
  if (opacity <= 0 || gradientHeight <= 0) return;
  const maxY = Math.min(gradientHeight, h);
  for (let y = 0; y < maxY; y++) {
    const factor = 1 - opacity * (1 - y / gradientHeight);
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      pixels[idx] = Math.round(pixels[idx] * factor);
      pixels[idx + 1] = Math.round(pixels[idx + 1] * factor);
      pixels[idx + 2] = Math.round(pixels[idx + 2] * factor);
    }
  }
}

// Generate a background image using pure JS image processing
async function generateBackground(
  artUrl: string,
  settings: BgSettings,
): Promise<string | null> {
  if (isPrivateUrl(artUrl)) {
    console.log('[SonosSync] Skipping BG for private URL');
    return null;
  }

  try {
    const response = await fetch(artUrl, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();

    // Decode JPEG
    let decoded;
    try {
      decoded = decodeJpeg(new Uint8Array(buffer), { useTArray: true, formatAsRGBA: true });
    } catch (e) {
      console.error('[SonosSync] JPEG decode failed:', e);
      return null;
    }

    const TARGET_W = 1280;
    const TARGET_H = 720;

    // Resize to target dimensions
    let pixels = resizeBilinear(decoded.data, decoded.width, decoded.height, TARGET_W, TARGET_H);

    // Apply blur (downscale-upscale trick)
    pixels = applyBlur(pixels, TARGET_W, TARGET_H, settings.blur);

    // Apply color adjustments
    applyColorAdjustments(pixels, TARGET_W, TARGET_H, settings.brightness, settings.contrast, settings.saturation);

    // Apply top gradient for header readability
    applyTopGradient(pixels, TARGET_W, TARGET_H, settings.topGradientOpacity, settings.topGradientHeight);

    // Encode as JPEG
    const encoded = encodeJpeg({ data: pixels, width: TARGET_W, height: TARGET_H }, 85);
    const base64 = btoa(String.fromCharCode(...new Uint8Array(encoded.data)));
    return `data:image/jpeg;base64,${base64}`;
  } catch (error) {
    console.error('[SonosSync] Background generation failed:', error);
    return null;
  }
}

// Upload base64 image to storage and return public URL
async function uploadBackground(
  supabase: any,
  base64DataUrl: string,
  fileName: string,
): Promise<string | null> {
  try {
    const base64 = base64DataUrl.replace(/^data:image\/\w+;base64,/, '');
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));

    const { error } = await supabase.storage
      .from('sonos-backgrounds')
      .upload(fileName, bytes, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (error) {
      console.error('[SonosSync] Upload error:', error.message);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from('sonos-backgrounds')
      .getPublicUrl(fileName);

    return urlData?.publicUrl ? `${urlData.publicUrl}?v=${Date.now()}` : null;
  } catch (error) {
    console.error('[SonosSync] Upload failed:', error);
    return null;
  }
}

// Check if a background file already exists in storage
async function backgroundExists(supabase: any, fileName: string): Promise<string | null> {
  const { data } = await supabase.storage
    .from('sonos-backgrounds')
    .list('', { search: fileName, limit: 1 });

  if (data && data.length > 0 && data[0].name === fileName) {
    const { data: urlData } = supabase.storage
      .from('sonos-backgrounds')
      .getPublicUrl(fileName);
    return urlData?.publicUrl || null;
  }
  return null;
}

// Clean up old background files, keeping only the specified ones
async function cleanupOldBackgrounds(supabase: any, keepFileNames: string[]) {
  try {
    const { data: files } = await supabase.storage
      .from('sonos-backgrounds')
      .list('', { limit: 50 });

    if (!files || files.length <= 10) return;

    const toDelete = files
      .filter((f: any) => !keepFileNames.includes(f.name))
      .slice(0, files.length - 5)
      .map((f: any) => f.name);

    if (toDelete.length > 0) {
      await supabase.storage.from('sonos-backgrounds').remove(toDelete);
      console.log(`[SonosSync] Cleaned up ${toDelete.length} old backgrounds`);
    }
  } catch {
    // Non-critical, ignore
  }
}

// Resolve background: check cache, generate if needed
async function resolveBackground(
  supabase: any,
  artUrl: string | null,
  trackId: string,
  settings: BgSettings,
): Promise<string | null> {
  if (!artUrl) return null;

  const trackHash = simpleHash(trackId || artUrl);
  const settingsHash = simpleHash(`${settings.blur}-${settings.brightness}-${settings.contrast}-${settings.saturation}-${settings.topGradientOpacity}-${settings.topGradientHeight}`);
  const fileName = `${trackHash}-${settingsHash}-v6.jpg`;

  // Check cache
  const existing = await backgroundExists(supabase, fileName);
  if (existing) {
    console.log(`[SonosSync] BG cache hit: ${fileName}`);
    return existing;
  }

  // Generate new background
  console.log(`[SonosSync] Generating BG: ${fileName}`);
  const base64 = await generateBackground(artUrl, settings);
  if (!base64) return null;

  const publicUrl = await uploadBackground(supabase, base64, fileName);
  return publicUrl;
}

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

  try {
    // Parallel fetch: tokens, settings
    const [tokenResult, settingsResult] = await Promise.all([
      supabase.from('sonos_tokens').select('*').limit(1).single(),
      supabase.from('sonos_settings').select('id, selected_group_id, bg_blur, bg_brightness, bg_contrast, bg_saturation, bg_top_gradient_opacity, bg_top_gradient_height').limit(1).single(),
    ]);

    const tokenData = tokenResult.data;
    const settings = settingsResult.data;

    if (!tokenData) {
      console.log('[SonosSync] Not connected to Sonos');
      return new Response(JSON.stringify({ ok: false, reason: 'not_connected' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const bgSettings: BgSettings = {
      blur: settings?.bg_blur ?? 40,
      brightness: settings?.bg_brightness ?? 0.35,
      contrast: settings?.bg_contrast ?? 1.0,
      saturation: settings?.bg_saturation ?? 1.0,
      topGradientOpacity: settings?.bg_top_gradient_opacity ?? 0.45,
      topGradientHeight: settings?.bg_top_gradient_height ?? 85,
    };

    // Check if token is expired and refresh if needed
    const isExpired = new Date(tokenData.expires_at) < new Date();
    let accessToken = tokenData.access_token;

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
        console.error('[SonosSync] Failed to refresh token');
        return new Response(JSON.stringify({ ok: false, reason: 'token_refresh_failed' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const tokens = await tokenResponse.json();
      accessToken = tokens.access_token;
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

      await supabase.from('sonos_tokens').update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt.toISOString(),
      }).eq('id', tokenData.id);
    }

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
            await supabase.from('sonos_tokens').update({ household_id: householdId }).eq('id', tokenData.id);
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

    async function resolveAlbumArt(
      imgUrl: string | null,
      objectId: string | undefined
    ): Promise<{ medium: string | null; small: string | null }> {
      if (!imgUrl) return { medium: null, small: null };
      if (imgUrl.includes('192.168.') || imgUrl.includes('getaa')) {
        const spotifyTrackId = extractSpotifyTrackId(objectId);
        if (spotifyTrackId) {
          console.log(`[SonosSync] Resolving art via oEmbed for track: ${spotifyTrackId}`);
          const art = await getAlbumArtViaOEmbed(spotifyTrackId);
          if (art.medium) return art;
        }
        return { medium: null, small: null };
      }
      return { medium: imgUrl, small: null };
    }

    const nextItem = metadata.nextItem;
    const nextTrack = nextItem?.track;
    const rawCurrentArt = track?.imageUrl || container?.imageUrl || null;
    const rawNextArt = nextTrack?.imageUrl || null;

    const [currentArt, nextArt] = await Promise.all([
      resolveAlbumArt(rawCurrentArt, track?.id?.objectId || currentItem?.id?.objectId),
      resolveAlbumArt(rawNextArt, nextTrack?.id?.objectId || nextItem?.id?.objectId),
    ]);

    // Generate background images via pure JS processing (parallel for current + next)
    let bgImageUrl: string | null = null;
    let nextBgImageUrl: string | null = null;

    if (currentArt.medium || nextArt.medium) {
      const currentTrackId = track?.id?.objectId || track?.name || '';
      const nextTrackId = nextTrack?.id?.objectId || nextTrack?.name || '';

      const [currentBg, nextBg] = await Promise.all([
        currentArt.medium
          ? resolveBackground(supabase, currentArt.medium, currentTrackId, bgSettings)
          : Promise.resolve(null),
        nextArt.medium
          ? resolveBackground(supabase, nextArt.medium, nextTrackId, bgSettings)
          : Promise.resolve(null),
      ]);

      bgImageUrl = currentBg;
      nextBgImageUrl = nextBg;

      // Cleanup old files (non-blocking)
      const keepFiles: string[] = [];
      if (currentBg) {
        const match = currentBg.match(/\/([^/?]+)\?/);
        if (match) keepFiles.push(match[1]);
      }
      if (nextBg) {
        const match = nextBg.match(/\/([^/?]+)\?/);
        if (match) keepFiles.push(match[1]);
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
    };

    // Upsert to DB
    const { data: existing } = await supabase
      .from('sonos_now_playing')
      .select('id')
      .eq('group_id', groupId)
      .limit(1)
      .single();

    if (existing) {
      await supabase.from('sonos_now_playing').update(nowPlaying).eq('id', existing.id);
    } else {
      await supabase.from('sonos_now_playing').insert(nowPlaying);
    }

    const duration = Date.now() - startTime;
    console.log(`[SonosSync] Done in ${duration}ms - ${track?.name || 'no track'} (bg: ${bgImageUrl ? 'yes' : 'no'})`);

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
