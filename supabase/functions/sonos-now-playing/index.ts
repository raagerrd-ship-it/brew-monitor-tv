import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SONOS_API_URL = 'https://api.ws.sonos.com/control/api/v1';

// In-memory cache for Spotify token (lives for duration of edge function instance)
let cachedSpotifyToken: { token: string; expiresAt: number } | null = null;

// Extract Spotify track ID from Sonos URI
function extractSpotifyTrackId(trackUri: string | undefined): string | null {
  if (!trackUri) return null;
  const match = trackUri.match(/spotify(?:%3a|:)track(?:%3a|:)([a-zA-Z0-9]+)/i);
  return match ? match[1] : null;
}

// Get Spotify access token with caching
async function getSpotifyToken(clientId: string, clientSecret: string): Promise<string | null> {
  // Check cache first
  if (cachedSpotifyToken && Date.now() < cachedSpotifyToken.expiresAt) {
    return cachedSpotifyToken.token;
  }

  try {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: 'grant_type=client_credentials',
    });
    
    if (!response.ok) return null;
    const data = await response.json();
    
    // Cache token (expires_in is typically 3600 seconds, cache for 3500 to be safe)
    cachedSpotifyToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 100) * 1000,
    };
    
    return data.access_token;
  } catch {
    return null;
  }
}

// Fetch album art from Spotify
async function getSpotifyAlbumArt(trackId: string, accessToken: string): Promise<string | null> {
  try {
    const response = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    
    if (!response.ok) return null;
    const track = await response.json();
    
    const images = track.album?.images;
    if (images && images.length > 0) {
      return images[1]?.url || images[0]?.url;
    }
    return null;
  } catch {
    return null;
  }
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
  const SPOTIFY_CLIENT_ID = Deno.env.get('SPOTIFY_CLIENT_ID');
  const SPOTIFY_CLIENT_SECRET = Deno.env.get('SPOTIFY_CLIENT_SECRET');

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    // Parallel fetch: tokens and settings
    const [tokenResult, settingsResult] = await Promise.all([
      supabase.from('sonos_tokens').select('*').limit(1).single(),
      supabase.from('sonos_settings').select('id, selected_group_id').limit(1).single(),
    ]);

    const tokenData = tokenResult.data;
    const settings = settingsResult.data;

    if (!tokenData) {
      return new Response(
        JSON.stringify({ error: 'Not connected to Sonos' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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
        return new Response(
          JSON.stringify({ error: 'Failed to refresh token' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const tokens = await tokenResponse.json();
      accessToken = tokens.access_token;
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

      // Don't await - fire and forget for speed
      supabase
        .from('sonos_tokens')
        .update({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: expiresAt.toISOString(),
        })
        .eq('id', tokenData.id)
        .then(() => {});
    }

    let groupId = settings?.selected_group_id;

    if (!groupId) {
      // Need to set up group - this is a one-time operation
      const householdsResponse = await fetch(`${SONOS_API_URL}/households`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });

      if (!householdsResponse.ok) {
        return new Response(
          JSON.stringify({ error: 'Failed to get Sonos households' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
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
            
            // Fire and forget
            supabase.from('sonos_settings').upsert({
              id: settings?.id || crypto.randomUUID(),
              selected_group_id: groupId,
              selected_group_name: groupsData.groups[0].name,
            }).then(() => {});
            
            supabase.from('sonos_tokens')
              .update({ household_id: householdId })
              .eq('id', tokenData.id)
              .then(() => {});
          }
        }
      }
    }

    if (!groupId) {
      return new Response(
        JSON.stringify({ error: 'No Sonos group available', needsSetup: true }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
      // Fire and forget cleanup
      supabase.from('sonos_now_playing')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000')
        .then(() => {});
      
      return new Response(
        JSON.stringify({ error: 'Failed to get playback metadata' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
    
    // Get album art - prefer Sonos URL if it's a valid external URL
    let albumArtUrl = track?.imageUrl || container?.imageUrl || null;
    
    // Only fetch Spotify art if we have a local Sonos URL
    if (albumArtUrl && (albumArtUrl.includes('192.168.') || albumArtUrl.includes('getaa'))) {
      const trackUri = track?.id?.objectId || currentItem?.id?.objectId;
      const spotifyTrackId = extractSpotifyTrackId(trackUri);
      
      if (spotifyTrackId && SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET) {
        // Get cached token or fetch new one
        const spotifyToken = await getSpotifyToken(SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET);
        if (spotifyToken) {
          const spotifyArt = await getSpotifyAlbumArt(spotifyTrackId, spotifyToken);
          if (spotifyArt) {
            albumArtUrl = spotifyArt;
          }
        }
      }
    }

    const nowPlaying = {
      group_id: groupId,
      track_name: track?.name || container?.name || null,
      artist_name: track?.artist?.name || null,
      album_name: track?.album?.name || null,
      album_art_url: albumArtUrl,
      playback_state: playbackState,
      duration_ms: track?.durationMillis || null,
      position_ms: positionMs,
    };

    // Fire and forget DB update - don't wait for it
    (async () => {
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
    })();

    const duration = Date.now() - startTime;
    console.log(`[Sonos] Response in ${duration}ms - ${track?.name || 'no track'}`);

    return new Response(
      JSON.stringify(nowPlaying),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Sonos now playing error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
