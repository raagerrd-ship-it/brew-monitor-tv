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

// Resolve album art URL, falling back to oEmbed for local network URLs
export async function resolveAlbumArt(
  imgUrl: string | null,
  objectId: string | undefined,
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
