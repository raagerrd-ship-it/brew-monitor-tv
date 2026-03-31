
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * sonos-auth — simplified, no OAuth flow needed.
 * Cast Away (UPnP bridge) handles all Sonos communication directly.
 * Only disconnect + status actions remain.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    // Disconnect - remove all Sonos data
    if (action === 'disconnect') {
      await Promise.all([
        supabase.from('sonos_tokens').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
        supabase.from('sonos_now_playing').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
        supabase.from('sonos_settings').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
      ]);

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check connection status (bridge-based: check if now_playing has data)
    if (action === 'status') {
      const { data: npData } = await supabase
        .from('sonos_now_playing')
        .select('id, group_id')
        .limit(1)
        .single();

      return new Response(
        JSON.stringify({
          connected: !!npData,
          expired: false,
          householdId: null,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Unknown action. Supported: disconnect, status' }),
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
