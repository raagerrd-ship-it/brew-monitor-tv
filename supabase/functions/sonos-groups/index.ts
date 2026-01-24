import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SONOS_API_URL = 'https://api.ws.sonos.com/control/api/v1';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const SONOS_CLIENT_ID = Deno.env.get('SONOS_CLIENT_ID');
  const SONOS_CLIENT_SECRET = Deno.env.get('SONOS_CLIENT_SECRET');

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
        JSON.stringify({ error: 'Not connected to Sonos', connected: false }),
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
          JSON.stringify({ error: 'Failed to refresh token', connected: false }),
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
    const allGroups: Array<{ id: string; name: string; householdId: string }> = [];

    // Get groups for each household
    for (const household of householdsData.households || []) {
      const groupsResponse = await fetch(`${SONOS_API_URL}/households/${household.id}/groups`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });

      if (groupsResponse.ok) {
        const groupsData = await groupsResponse.json();
        for (const group of groupsData.groups || []) {
          allGroups.push({
            id: group.id,
            name: group.name,
            householdId: household.id,
          });
        }
      }
    }

    // Get current settings
    const { data: settings } = await supabase
      .from('sonos_settings')
      .select('*')
      .limit(1)
      .single();

    return new Response(
      JSON.stringify({
        connected: true,
        groups: allGroups,
        selectedGroupId: settings?.selected_group_id,
        selectedGroupName: settings?.selected_group_name,
        showOnDashboard: settings?.show_on_dashboard ?? true,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Sonos groups error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
