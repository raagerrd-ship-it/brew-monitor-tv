// Cache for oEmbed results (lives for duration of edge function instance)
const oEmbedCache = new Map<string, string>();

export function extractSpotifyTrackId(trackUri: string | undefined): string | null {
  if (!trackUri) return null;
  const match = trackUri.match(/spotify(?:%3a|:)track(?:%3a|:)([a-zA-Z0-9]+)/i);
  return match ? match[1] : null;
}

// Upgrade Spotify CDN image URL from 300x300 to 640x640
function upgradeSpotifyImageSize(url: string): string {
  return url.replace('ab67616d00001e02', 'ab67616d0000b273');
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
  // objectId patterns: "x-sonosapi-hls-static:VIDEO_ID?sid=..." or similar
  const combined = `${objectId || ''} ${imgUrl || ''}`;
  // YouTube video IDs are 11 characters: letters, digits, hyphens, underscores
  const match = combined.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|x-sonosapi-hls-static[:%]3[aA])([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

// Get YouTube thumbnail URL
async function getYouTubeThumbnail(videoId: string): Promise<string | null> {
  // Try maxresdefault first, fall back to hqdefault
  for (const quality of ['maxresdefault', 'hqdefault', 'mqdefault']) {
    const url = `https://img.youtube.com/vi/${videoId}/${quality}.jpg`;
    try {
      const resp = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
      if (resp.ok) {
        const contentLength = resp.headers.get('content-length');
        // YouTube returns a small placeholder for non-existent thumbnails
        if (contentLength && parseInt(contentLength) > 1000) {
          console.log(`[SonosSync] YouTube thumbnail found: ${quality} for ${videoId}`);
          return url;
        }
      }
    } catch { /* continue */ }
  }
  return null;
}

// Resolve album art URL, falling back to oEmbed/YouTube for local network URLs
export async function resolveAlbumArt(
  imgUrl: string | null,
  objectId: string | undefined,
): Promise<{ medium: string | null; small: string | null }> {
  if (!imgUrl) return { medium: null, small: null };
  if (imgUrl.includes('192.168.') || imgUrl.includes('getaa')) {
    // Try Spotify first
    const spotifyTrackId = extractSpotifyTrackId(objectId);
    if (spotifyTrackId) {
      console.log(`[SonosSync] Resolving art via oEmbed for track: ${spotifyTrackId}`);
      const art = await getAlbumArtViaOEmbed(spotifyTrackId);
      if (art.medium) return art;
    }
    // Try YouTube thumbnail
    const ytId = extractYouTubeVideoId(objectId, imgUrl);
    if (ytId) {
      console.log(`[SonosSync] Trying YouTube thumbnail for video: ${ytId}`);
      const ytThumb = await getYouTubeThumbnail(ytId);
      if (ytThumb) return { medium: ytThumb, small: null };
    }
    console.log(`[SonosSync] No public art found for local URL (objectId: ${objectId})`);
    return { medium: null, small: null };
  }
  return { medium: imgUrl, small: null };
}
