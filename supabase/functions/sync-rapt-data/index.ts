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

// Color map for pill names
const colorMap: Record<string, string> = {
  'black': '#1f2937', 'svart': '#1f2937',
  'blue': '#3b82f6', 'blå': '#3b82f6',
  'green': '#22c55e', 'grön': '#22c55e',
  'orange': '#f97316',
  'pink': '#ec4899', 'rosa': '#ec4899',
  'purple': '#a855f7', 'lila': '#a855f7',
  'red': '#ef4444', 'röd': '#ef4444',
  'yellow': '#eab308', 'gul': '#eab308',
  'white': '#f3f4f6', 'vit': '#f3f4f6',
};

const extractColor = (name: string): string => {
  const nameLower = name.toLowerCase();
  for (const [colorName, hexValue] of Object.entries(colorMap)) {
    if (nameLower.includes(colorName)) return hexValue;
  }
  return '#1f2937';
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Starting RAPT full sync (data + auto-discovery)...');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Update timestamp + get auth token in parallel
    const [accessToken] = await Promise.all([
      getRaptToken(),
      supabase.from('sync_settings')
        .update({ last_rapt_sync_at: new Date().toISOString() })
        .not('id', 'is', null)
        .then(({ error }) => { if (error) console.error('sync_settings update error:', error); }),
    ]);

    // Fetch pills + controllers + DB state ALL in parallel
    const [pills, controllers, { data: activeSessions }, { data: autoCoolingSettings }] = await Promise.all([
      fetchRaptPills(accessToken),
      fetchRaptControllers(accessToken).catch(err => { console.error('Controllers fetch failed:', err); return []; }),
      supabase.from('fermentation_sessions').select('controller_id').in('status', ['running', 'paused']),
      supabase.from('auto_cooling_settings').select('cooler_controller_id, enabled').limit(1).single(),
    ]);

    console.log(`Received ${pills.length} Pills, ${controllers.length} Controllers`);

    const controllersWithActiveSessions = new Set(activeSessions?.map(s => s.controller_id) || []);
    const coolerControllerId = autoCoolingSettings?.enabled ? autoCoolingSettings?.cooler_controller_id : null;

    // ── Upsert Pills (batch) ──
    const pillsData = pills.map((pill: any) => ({
      pill_id: pill.id,
      name: pill.name || 'Unknown Pill',
      color: extractColor(pill.name || ''),
      battery_level: Math.round(pill.battery || 0),
      last_update: pill.lastActivityTime ? new Date(pill.lastActivityTime).toISOString() : new Date().toISOString(),
      paired_device_id: pill.pairedDeviceId || null,
    }));

    if (pillsData.length > 0) {
      const { error } = await supabase.from('rapt_pills').upsert(pillsData, { onConflict: 'pill_id' });
      if (error) throw new Error(`Failed to upsert Pills: ${error.message}`);
      console.log(`Synced ${pillsData.length} Pills`);
    }

    // ── Upsert Controllers (batch) — skip target_temp for managed controllers ──
    if (controllers.length > 0) {
      const controllersData = controllers.map((controller: any) => {
        const hasActiveSession = controllersWithActiveSessions.has(controller.id);
        const isCoolerController = controller.id === coolerControllerId;

        const data: Record<string, any> = {
          controller_id: controller.id,
          name: controller.name || 'Unknown Controller',
          current_temp: controller.temperature || null,
          pill_temp: controller.controlDeviceTemperature || null,
          cooling_enabled: controller.coolingEnabled || false,
          heating_enabled: controller.heatingEnabled || false,
          heating_utilisation: controller.heatingUtilisation || 0,
          cooling_hysteresis: controller.coolingHysteresis ?? 0.2,
          heating_hysteresis: controller.heatingHysteresis ?? 0.2,
          cooling_run_time: controller.coolingRunTime || 0,
          cooling_starts: controller.coolingStarts || 0,
          heating_run_time: controller.heatingRunTime || 0,
          heating_starts: controller.heatingStarts || 0,
          last_update: controller.lastActivityTime ? new Date(controller.lastActivityTime).toISOString() : new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        // Only include target_temp if NOT managed
        if (!hasActiveSession && !isCoolerController) {
          data.target_temp = controller.targetTemperature || null;
        }

        return data;
      });

      // For managed controllers we can't use simple upsert (target_temp must be preserved)
      // Split into managed vs unmanaged
      const managedIds = new Set([
        ...Array.from(controllersWithActiveSessions),
        ...(coolerControllerId ? [coolerControllerId] : []),
      ]);
      
      const unmanagedControllers = controllersData.filter(c => !managedIds.has(c.controller_id));
      const managedControllers = controllersData.filter(c => managedIds.has(c.controller_id));

      const ops: Promise<any>[] = [];
      
      if (unmanagedControllers.length > 0) {
        // Unmanaged: full upsert including target_temp
        const withTarget = unmanagedControllers.map(c => ({
          ...c,
          target_temp: controllers.find((raw: any) => raw.id === c.controller_id)?.targetTemperature || null,
        }));
        ops.push(supabase.from('rapt_temp_controllers').upsert(withTarget, { onConflict: 'controller_id' }));
      }

      // Managed: upsert WITHOUT target_temp (already excluded from data above)
      if (managedControllers.length > 0) {
        for (const c of managedControllers) {
          ops.push(
            supabase.from('rapt_temp_controllers')
              .update(c)
              .eq('controller_id', c.controller_id)
          );
        }
      }

      await Promise.all(ops);
      console.log(`Synced ${controllersData.length} Controllers`);
    }

    // ── Auto-discovery: add new pills/controllers to selection tables ──
    const [{ data: existingSelectedPills }, { data: existingSelectedControllers }] = await Promise.all([
      supabase.from('selected_rapt_pills').select('pill_id'),
      supabase.from('selected_rapt_temp_controllers').select('controller_id'),
    ]);

    const existingPillIds = new Set(existingSelectedPills?.map(s => s.pill_id) || []);
    const existingControllerIds = new Set(existingSelectedControllers?.map(s => s.controller_id) || []);

    const discoveryOps: Promise<any>[] = [];

    // New pills
    const newPills = pillsData.filter(p => !existingPillIds.has(p.pill_id));
    if (newPills.length > 0) {
      const { data: maxPillOrder } = await supabase.from('selected_rapt_pills')
        .select('display_order').order('display_order', { ascending: false }).limit(1);
      let nextPillOrder = (maxPillOrder && maxPillOrder.length > 0) ? maxPillOrder[0].display_order + 1 : 1;
      
      discoveryOps.push(supabase.from('selected_rapt_pills').insert(
        newPills.map(p => ({ pill_id: p.pill_id, is_visible: true, display_order: nextPillOrder++ }))
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
      JSON.stringify({ success: true, pillsCount: pillsData.length, controllersCount: controllers.length }),
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
