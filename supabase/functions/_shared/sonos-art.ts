// Cache for oEmbed results (lives for duration of edge function instance)
const oEmbedCache = new Map<string, string>();

// Cache for Spotify client credentials token
let spotifyTokenCache: { token: string; expiresAt: number } | null = null;

export function extractSpotifyTrackId(trackUri: string | undefined): string | null {
  if (!trackUri) return null;
  const match = trackUri.match(/spotify(?:%3a|:)track(?:%3a|:)([a-zA-Z0-9]+)/i);
  return match ? match[1] : null;
}

// Upgrade Spotify CDN image URL from 300x300 to 640x640
function upgradeSpotifyImageSize(url: string): string {
  return url.replace('ab67616d00001e02', 'ab67616d0000b273');
}

// Extract public URL from Sonos getaa proxy URL
// e.g. http://192.168.1.x:1400/getaa?s=1&u=https%3A%2F%2Flh3.googleusercontent.com%2F...
function extractPublicUrlFromGetaa(imgUrl: string): string | null {
  try {
    const url = new URL(imgUrl);
    const uParam = url.searchParams.get('u');
    if (uParam) {
      const decoded = decodeURIComponent(uParam);
      if (decoded.startsWith('https://')) {
        console.log(`[SonosArt] Extracted public URL from getaa: ${decoded.substring(0, 80)}...`);
        return decoded;
      }
    }
  } catch { /* not a valid URL */ }
  return null;
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
    let thumbUrl = data.thumbnail_url || null;
    if (thumbUrl) {
      thumbUrl = upgradeSpotifyImageSize(thumbUrl);
      oEmbedCache.set(trackId, thumbUrl);
    }
    return { medium: thumbUrl, small: null };
  } catch {
    return { medium: null, small: null };
  }
}

// Try to extract YouTube video ID from Sonos objectId or local URL
function extractYouTubeVideoId(objectId: string | undefined, imgUrl: string | null): string | null {
  if (!objectId && !imgUrl) return null;
  const combined = `${objectId || ''} ${imgUrl || ''}`;
  const match = combined.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|x-sonosapi-hls-static[:%]3[aA])([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

// Get YouTube thumbnail URL
async function getYouTubeThumbnail(videoId: string): Promise<string | null> {
  for (const quality of ['maxresdefault', 'hqdefault', 'mqdefault']) {
    const url = `https://img.youtube.com/vi/${videoId}/${quality}.jpg`;
    try {
      const resp = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
      if (resp.ok) {
        const contentLength = resp.headers.get('content-length');
        if (contentLength && parseInt(contentLength) > 1000) {
          console.log(`[SonosArt] YouTube thumbnail found: ${quality} for ${videoId}`);
          return url;
        }
      }
    } catch { /* continue */ }
  }
  return null;
}

// Get Spotify access token via Client Credentials flow (cached ~1h)
async function getSpotifyClientToken(): Promise<string | null> {
  if (spotifyTokenCache && Date.now() < spotifyTokenCache.expiresAt) {
    return spotifyTokenCache.token;
  }

  const clientId = Deno.env.get('SPOTIFY_CLIENT_ID');
  const clientSecret = Deno.env.get('SPOTIFY_CLIENT_SECRET');
  if (!clientId || !clientSecret) return null;

  try {
    const resp = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    spotifyTokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 60) * 1000, // refresh 1 min early
    };
    console.log(`[SonosArt] Spotify client token acquired`);
    return data.access_token;
  } catch {
    return null;
  }
}

// Search Spotify for album art by track name + artist
async function searchSpotifyForArt(
  trackName: string,
  artistName: string | null,
): Promise<{ medium: string | null; small: string | null }> {
  const token = await getSpotifyClientToken();
  if (!token) return { medium: null, small: null };

  try {
    let q = `track:${trackName}`;
    if (artistName) q += ` artist:${artistName}`;
    const params = new URLSearchParams({ q, type: 'track', limit: '1' });
    const resp = await fetch(`https://api.spotify.com/v1/search?${params}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return { medium: null, small: null };
    const data = await resp.json();
    const images = data.tracks?.items?.[0]?.album?.images;
    if (images && images.length > 0) {
      // images[0] is largest (usually 640x640)
      const artUrl = images[0].url;
      console.log(`[SonosArt] Spotify Search hit for "${trackName}" → ${artUrl.substring(0, 60)}...`);
      return { medium: artUrl, small: images.length > 1 ? images[images.length - 1].url : null };
    }
  } catch (e) {
    console.error(`[SonosArt] Spotify Search error:`, e);
  }
  return { medium: null, small: null };
}

// Resolve album art URL, falling back to oEmbed/YouTube/Spotify Search for local network URLs
export async function resolveAlbumArt(
  imgUrl: string | null,
  objectId: string | undefined,
  trackName?: string | null,
  artistName?: string | null,
): Promise<{ medium: string | null; small: string | null }> {
  if (!imgUrl && !trackName) return { medium: null, small: null };

  const isLocal = imgUrl ? (imgUrl.includes('192.168.') || imgUrl.includes('10.') || imgUrl.includes('getaa')) : true;

  if (isLocal) {
    if (imgUrl) console.log(`[SonosArt] Local/missing URL detected: ${imgUrl.substring(0, 120)}`);

    // Step 1: Try extracting public URL from getaa u-parameter
    const publicUrl = imgUrl ? extractPublicUrlFromGetaa(imgUrl) : null;
    if (publicUrl) {
      console.log(`[SonosArt] ✓ Step 1 (getaa extract) succeeded`);
      return { medium: publicUrl, small: null };
    }
    if (imgUrl) console.log(`[SonosArt] ✗ Step 1 (getaa extract) — no u-parameter found`);

    // Step 2: Try Spotify oEmbed for native Spotify content
    const spotifyTrackId = extractSpotifyTrackId(objectId);
    if (spotifyTrackId) {
      console.log(`[SonosArt] → Step 2 (oEmbed) trying track: ${spotifyTrackId}`);
      const art = await getAlbumArtViaOEmbed(spotifyTrackId);
      if (art.medium) { console.log(`[SonosArt] ✓ Step 2 (oEmbed) succeeded`); return art; }
      console.log(`[SonosArt] ✗ Step 2 (oEmbed) — no result`);
    } else {
      console.log(`[SonosArt] ✗ Step 2 (oEmbed) — not Spotify content (objectId: ${objectId?.substring(0, 30)})`);
    }

    // Step 3: Try YouTube thumbnail
    const ytId = extractYouTubeVideoId(objectId, imgUrl);
    if (ytId) {
      console.log(`[SonosArt] → Step 3 (YouTube) trying video: ${ytId}`);
      const ytThumb = await getYouTubeThumbnail(ytId);
      if (ytThumb) { console.log(`[SonosArt] ✓ Step 3 (YouTube) succeeded`); return { medium: ytThumb, small: null }; }
      console.log(`[SonosArt] ✗ Step 3 (YouTube) — thumbnail not found or too small`);
    } else {
      console.log(`[SonosArt] ✗ Step 3 (YouTube) — no video ID found`);
    }

    // Step 4: Spotify Search API fallback (works for any service if track exists on Spotify)
    if (trackName) {
      console.log(`[SonosArt] → Step 4 (Spotify Search) trying "${trackName}" by "${artistName || 'unknown'}"`);
      const searchResult = await searchSpotifyForArt(trackName, artistName || null);
      if (searchResult.medium) { console.log(`[SonosArt] ✓ Step 4 (Spotify Search) succeeded`); return searchResult; }
      console.log(`[SonosArt] ✗ Step 4 (Spotify Search) — no match found`);
    } else {
      console.log(`[SonosArt] ✗ Step 4 (Spotify Search) — no track name available`);
    }

    console.log(`[SonosArt] ✗ All 4 steps failed for "${trackName || objectId}"`);
    return { medium: null, small: null };
  }
  return { medium: imgUrl, small: null };
}
