
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const SONOS_AUTH_URL = 'https://api.sonos.com/login/v3/oauth';
const SONOS_TOKEN_URL = 'https://api.sonos.com/login/v3/oauth/access';
const REDIRECT_URI = 'https://brew-monitor-tv.lovable.app/sonos-callback';

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  const SONOS_CLIENT_ID = Deno.env.get('SONOS_CLIENT_ID');
  const SONOS_CLIENT_SECRET = Deno.env.get('SONOS_CLIENT_SECRET');
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!SONOS_CLIENT_ID || !SONOS_CLIENT_SECRET) {
    return new Response(
      JSON.stringify({ error: 'Sonos credentials not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    // Generate OAuth URL for user to authorize
    if (action === 'start') {
      const state = crypto.randomUUID();
      const scope = 'playback-control-all';
      
      const authUrl = `${SONOS_AUTH_URL}?client_id=${SONOS_CLIENT_ID}&response_type=code&state=${state}&scope=${scope}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
      
      return new Response(
        JSON.stringify({ authUrl, state }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle OAuth callback - exchange code for tokens
    if (action === 'callback') {
      const code = url.searchParams.get('code');
      
      if (!code) {
        return new Response(
          JSON.stringify({ error: 'No authorization code provided' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Exchange code for tokens
      const tokenResponse = await fetch(SONOS_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${btoa(`${SONOS_CLIENT_ID}:${SONOS_CLIENT_SECRET}`)}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('Token exchange failed:', errorText);
        return new Response(
          JSON.stringify({ error: 'Failed to exchange authorization code', details: errorText }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const tokens = await tokenResponse.json();
      
      // Calculate expiration time
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

      // Delete any existing tokens first
      await supabase.from('sonos_tokens').delete().neq('id', '00000000-0000-0000-0000-000000000000');

      // Store tokens in database
      const { error: insertError } = await supabase.from('sonos_tokens').insert({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt.toISOString(),
      });

      if (insertError) {
        console.error('Failed to store tokens:', insertError);
        return new Response(
          JSON.stringify({ error: 'Failed to store tokens' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Ensure settings row exists
      const { data: existingSettings } = await supabase.from('sonos_settings').select('id').limit(1).single();
      if (!existingSettings) {
        await supabase.from('sonos_settings').insert({});
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Disconnect - remove all tokens and settings
    if (action === 'disconnect') {
      await supabase.from('sonos_tokens').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('sonos_now_playing').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('sonos_settings').delete().neq('id', '00000000-0000-0000-0000-000000000000');

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check connection status
    if (action === 'status') {
      const { data: tokenData } = await supabase
        .from('sonos_tokens')
        .select('id, expires_at, household_id')
        .limit(1)
        .single();

      const isConnected = !!tokenData;
      const isExpired = tokenData ? new Date(tokenData.expires_at) < new Date() : true;

      return new Response(
        JSON.stringify({ 
          connected: isConnected,
          expired: isExpired,
          householdId: tokenData?.household_id 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Unknown action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Sonos auth error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
