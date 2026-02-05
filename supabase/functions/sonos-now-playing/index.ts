import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SONOS_API_URL = 'https://api.ws.sonos.com/control/api/v1';

// Extract Spotify track ID from Sonos URI
function extractSpotifyTrackId(trackUri: string | undefined): string | null {
  if (!trackUri) return null;
  // Format: x-sonos-spotify:spotify:track:TRACKID?...
  const match = trackUri.match(/spotify(?:%3a|:)track(?:%3a|:)([a-zA-Z0-9]+)/i);
  return match ? match[1] : null;
}

// Get Spotify access token using client credentials
async function getSpotifyToken(clientId: string, clientSecret: string): Promise<string | null> {
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
    return data.access_token;
  } catch {
    return null;
  }
}

// Fetch album art from Spotify - prefer medium size for performance
async function getSpotifyAlbumArt(trackId: string, accessToken: string): Promise<string | null> {
  try {
    const response = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    
    if (!response.ok) return null;
    const track = await response.json();
    
    // Spotify provides images in order: large (640px), medium (300px), small (64px)
    // Use medium (300px) for better performance - good enough for blurred backgrounds
    const images = track.album?.images;
    if (images && images.length > 0) {
      // Prefer medium size (index 1), fallback to first available
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

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const SONOS_CLIENT_ID = Deno.env.get('SONOS_CLIENT_ID');
  const SONOS_CLIENT_SECRET = Deno.env.get('SONOS_CLIENT_SECRET');
  const SPOTIFY_CLIENT_ID = Deno.env.get('SPOTIFY_CLIENT_ID');
  const SPOTIFY_CLIENT_SECRET = Deno.env.get('SPOTIFY_CLIENT_SECRET');

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    // Get tokens
    const { data: tokenData } = await supabase
      .from('sonos_tokens')
      .select('*')
      .limit(1)
      .single();

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
      console.log('Token expired, refreshing...');
      
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
        console.error('Token refresh failed');
        return new Response(
          JSON.stringify({ error: 'Failed to refresh token' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const tokens = await tokenResponse.json();
      accessToken = tokens.access_token;
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

      await supabase
        .from('sonos_tokens')
        .update({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: expiresAt.toISOString(),
        })
        .eq('id', tokenData.id);
    }

    // Get settings to find selected group
    const { data: settings } = await supabase
      .from('sonos_settings')
      .select('id, selected_group_id')
      .limit(1)
      .single();

    // If no group selected, try to get households and groups first
    let groupId = settings?.selected_group_id;

    if (!groupId) {
      // Get households
      const householdsResponse = await fetch(`${SONOS_API_URL}/households`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });

      if (!householdsResponse.ok) {
        const errorText = await householdsResponse.text();
        console.error('Failed to get households:', errorText);
        return new Response(
          JSON.stringify({ error: 'Failed to get Sonos households' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const householdsData = await householdsResponse.json();
      
      if (householdsData.households?.length > 0) {
        const householdId = householdsData.households[0].id;
        
        // Update household_id in tokens
        await supabase
          .from('sonos_tokens')
          .update({ household_id: householdId })
          .eq('id', tokenData.id);

        // Get groups for this household
        const groupsResponse = await fetch(`${SONOS_API_URL}/households/${householdId}/groups`, {
          headers: { 'Authorization': `Bearer ${accessToken}` },
        });

        if (groupsResponse.ok) {
          const groupsData = await groupsResponse.json();
          if (groupsData.groups?.length > 0) {
            groupId = groupsData.groups[0].id;
            
            // Auto-select first group
            await supabase.from('sonos_settings').upsert({
              id: settings?.id || crypto.randomUUID(),
              selected_group_id: groupId,
              selected_group_name: groupsData.groups[0].name,
            });
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

    // Get playback metadata
    const metadataResponse = await fetch(`${SONOS_API_URL}/groups/${groupId}/playbackMetadata`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!metadataResponse.ok) {
      const errorText = await metadataResponse.text();
      console.error('Failed to get metadata:', errorText);
      
      // Clear now playing on error
      await supabase
        .from('sonos_now_playing')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');
      
      return new Response(
        JSON.stringify({ error: 'Failed to get playback metadata' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const metadata = await metadataResponse.json();

    // Get playback status
    const playbackResponse = await fetch(`${SONOS_API_URL}/groups/${groupId}/playback`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    let playbackState = 'IDLE';
    let positionMs = 0;

    if (playbackResponse.ok) {
      const playbackData = await playbackResponse.json();
      playbackState = playbackData.playbackState || 'IDLE';
      positionMs = playbackData.positionMillis || 0;
    }

    // Extract track info
    const container = metadata.container;
    const currentItem = metadata.currentItem;
    const track = currentItem?.track;
    
    // Get album art - try Spotify first if available
    let albumArtUrl = track?.imageUrl || container?.imageUrl || null;
    
    // Check if it's a local Sonos URL and try to get Spotify album art instead
    if (albumArtUrl && (albumArtUrl.includes('192.168.') || albumArtUrl.includes('getaa'))) {
      const trackUri = track?.id?.objectId || currentItem?.id?.objectId;
      const spotifyTrackId = extractSpotifyTrackId(trackUri);
      
      if (spotifyTrackId && SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET) {
        console.log('Fetching Spotify album art for track:', spotifyTrackId);
        const spotifyToken = await getSpotifyToken(SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET);
        if (spotifyToken) {
          const spotifyArt = await getSpotifyAlbumArt(spotifyTrackId, spotifyToken);
          if (spotifyArt) {
            albumArtUrl = spotifyArt;
            console.log('Got Spotify album art:', spotifyArt);
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

    // Upsert now playing data
    const { data: existingNowPlaying } = await supabase
      .from('sonos_now_playing')
      .select('id')
      .eq('group_id', groupId)
      .limit(1)
      .single();

    if (existingNowPlaying) {
      await supabase
        .from('sonos_now_playing')
        .update(nowPlaying)
        .eq('id', existingNowPlaying.id);
    } else {
      await supabase.from('sonos_now_playing').insert(nowPlaying);
    }

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
