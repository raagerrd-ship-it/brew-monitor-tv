import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface SpotifySearchResult {
  tracks: {
    items: Array<{
      id: string;
      name: string;
      artists: Array<{ name: string }>;
    }>;
  };
}

interface SpotifyAudioFeatures {
  tempo: number;
  energy: number;
  danceability: number;
}

// Cache for Spotify access token
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getSpotifyToken(): Promise<string> {
  // Return cached token if still valid (with 1 minute buffer)
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) {
    return cachedToken.token;
  }

  const clientId = Deno.env.get('SPOTIFY_CLIENT_ID');
  const clientSecret = Deno.env.get('SPOTIFY_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    throw new Error('Spotify credentials not configured');
  }

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Spotify token error:', errorText);
    throw new Error('Failed to get Spotify access token');
  }

  const data: SpotifyTokenResponse = await response.json();
  
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
  };

  return data.access_token;
}

async function searchTrack(token: string, trackName: string, artistName: string): Promise<string | null> {
  // Clean up search query
  const query = `track:${trackName} artist:${artistName}`.replace(/['"]/g, '');
  
  const response = await fetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Spotify search error:', errorText);
    return null;
  }

  const data: SpotifySearchResult = await response.json();
  
  if (data.tracks.items.length === 0) {
    return null;
  }

  return data.tracks.items[0].id;
}

async function getAudioFeatures(token: string, trackId: string): Promise<SpotifyAudioFeatures | null> {
  const response = await fetch(
    `https://api.spotify.com/v1/audio-features/${trackId}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Spotify audio features error:', errorText);
    return null;
  }

  const data = await response.json();
  
  return {
    tempo: data.tempo,
    energy: data.energy,
    danceability: data.danceability,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { trackName, artistName } = await req.json();

    if (!trackName || !artistName) {
      return new Response(
        JSON.stringify({ error: 'trackName and artistName are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = await getSpotifyToken();
    const trackId = await searchTrack(token, trackName, artistName);

    if (!trackId) {
      return new Response(
        JSON.stringify({ error: 'Track not found', tempo: null }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const audioFeatures = await getAudioFeatures(token, trackId);

    if (!audioFeatures) {
      return new Response(
        JSON.stringify({ error: 'Audio features not available', tempo: null }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        trackId,
        tempo: audioFeatures.tempo,
        energy: audioFeatures.energy,
        danceability: audioFeatures.danceability,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
