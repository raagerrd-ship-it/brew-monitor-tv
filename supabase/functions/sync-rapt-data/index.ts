import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// ── Inlined RAPT auth ──
async function getRaptToken(): Promise<string> {
  const RAPT_USERNAME = Deno.env.get('RAPT_USERNAME');
  const RAPT_API_SECRET = Deno.env.get('RAPT_API_SECRET');
  if (!RAPT_USERNAME || !RAPT_API_SECRET) throw new Error('RAPT credentials not configured');

  const formData = new URLSearchParams();
  formData.append('client_id', 'rapt-user');
  formData.append('grant_type', 'password');
  formData.append('username', RAPT_USERNAME);
  formData.append('password', RAPT_API_SECRET);

  const authBaseUrl = Deno.env.get('RAPT_AUTH_BASE_URL') || 'https://id.rapt.io';
  const res = await fetch(`${authBaseUrl}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`RAPT auth error: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

// ── Inlined RAPT API fetches ──
async function fetchRaptPills(accessToken: string): Promise<any[]> {
  const apiBaseUrl = Deno.env.get('RAPT_API_BASE_URL') || 'https://api.rapt.io';
  const res = await fetch(`${apiBaseUrl}/api/Hydrometers/GetHydrometers`, {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`RAPT pills API error: ${res.status}`);
  return res.json();
}

async function fetchRaptControllers(accessToken: string): Promise<any[]> {
  const apiBaseUrl = Deno.env.get('RAPT_API_BASE_URL') || 'https://api.rapt.io';
  const res = await fetch(`${apiBaseUrl}/api/TemperatureControllers/GetTemperatureControllers`, {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`RAPT controllers API error: ${res.status}`);
  return res.json();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Starting RAPT auto-discovery (new devices only)...');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Accept pre-fetched token from caller (e.g. full-sync-brew-data) to avoid double auth
    let passedToken: string | null = null;
    try {
      const body = await req.json();
      passedToken = body?.access_token || null;
    } catch { /* no body or invalid JSON — that's fine */ }

    // Update timestamp + get auth token in parallel (skip auth if token was passed)
    const [accessToken] = await Promise.all([
      passedToken ? Promise.resolve(passedToken) : getRaptToken(),
      supabase.from('sync_settings')
        .update({ last_rapt_sync_at: new Date().toISOString() })
        .not('id', 'is', null)
        .then(({ error }) => { if (error) console.error('sync_settings update error:', error); }),
    ]);

    // Fetch pills + controllers from RAPT API in parallel
    const [pills, controllers] = await Promise.all([
      fetchRaptPills(accessToken),
      fetchRaptControllers(accessToken).catch(err => { console.error('Controllers fetch failed:', err); return []; }),
    ]);

    console.log(`Received ${pills.length} Pills, ${controllers.length} Controllers from RAPT API`);

    // ── Auto-discovery: add new pills/controllers to selection tables ──
    const [{ data: existingSelectedPills }, { data: existingSelectedControllers }] = await Promise.all([
      supabase.from('selected_rapt_pills').select('pill_id'),
      supabase.from('selected_rapt_temp_controllers').select('controller_id'),
    ]);

    const existingPillIds = new Set(existingSelectedPills?.map(s => s.pill_id) || []);
    const existingControllerIds = new Set(existingSelectedControllers?.map(s => s.controller_id) || []);

    const discoveryOps: Promise<any>[] = [];

    // New pills
    const newPills = pills.filter((p: any) => !existingPillIds.has(p.id));
    if (newPills.length > 0) {
      const { data: maxPillOrder } = await supabase.from('selected_rapt_pills')
        .select('display_order').order('display_order', { ascending: false }).limit(1);
      let nextPillOrder = (maxPillOrder && maxPillOrder.length > 0) ? maxPillOrder[0].display_order + 1 : 1;
      
      discoveryOps.push(supabase.from('selected_rapt_pills').insert(
        newPills.map((p: any) => ({ pill_id: p.id, is_visible: true, display_order: nextPillOrder++ }))
      ));
      console.log(`Auto-added ${newPills.length} new pills to selection`);
    }

    // New controllers
    const newControllers = controllers.filter((c: any) => !existingControllerIds.has(c.id));
    if (newControllers.length > 0) {
      const { data: maxCtrlOrder } = await supabase.from('selected_rapt_temp_controllers')
        .select('display_order').order('display_order', { ascending: false }).limit(1);
      let nextCtrlOrder = (maxCtrlOrder && maxCtrlOrder.length > 0) ? maxCtrlOrder[0].display_order + 1 : 1;
      
      discoveryOps.push(supabase.from('selected_rapt_temp_controllers').insert(
        newControllers.map((c: any) => ({ controller_id: c.id, is_visible: true, display_order: nextCtrlOrder++ }))
      ));
      console.log(`Auto-added ${newControllers.length} new controllers to selection`);
    }

    if (discoveryOps.length > 0) await Promise.all(discoveryOps);

    return new Response(
      JSON.stringify({ success: true, newPills: newPills.length, newControllers: newControllers.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in sync-rapt-data function:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
