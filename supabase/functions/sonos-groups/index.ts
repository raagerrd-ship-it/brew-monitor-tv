import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getValidAccessToken } from "../_shared/sonos-token.ts";

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
    const tokenResult = await getValidAccessToken(supabase, SONOS_CLIENT_ID!, SONOS_CLIENT_SECRET!);

    if (!tokenResult) {
      return new Response(
        JSON.stringify({ connected: false, groups: [] }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const accessToken = tokenResult.accessToken;

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
