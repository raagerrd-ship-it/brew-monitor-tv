import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { createBrewSnapshots } from '../_shared/brew-snapshots.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// ── Inlined RAPT auth (saves 1 HTTP hop) ──
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

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`RAPT auth error: ${res.status} ${errorText}`);
  }
  const data = await res.json();
  return data.access_token;
}

// ── Inlined RAPT API fetches (saves 2 HTTP hops) ──
async function fetchRaptPills(accessToken: string): Promise<any[]> {
  const apiBaseUrl = Deno.env.get('RAPT_API_BASE_URL') || 'https://api.rapt.io';
  const res = await fetch(`${apiBaseUrl}/api/Hydrometers/GetHydrometers`, {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`RAPT pills API error: ${res.status} ${t}`); }
  return res.json();
}

async function fetchRaptControllers(accessToken: string): Promise<any[]> {
  const apiBaseUrl = Deno.env.get('RAPT_API_BASE_URL') || 'https://api.rapt.io';
  const res = await fetch(`${apiBaseUrl}/api/TemperatureControllers/GetTemperatureControllers`, {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`RAPT controllers API error: ${res.status} ${t}`); }
  return res.json();
}

// ── Inlined Brewfather readings fetch (saves 1 HTTP hop per brew) ──
async function fetchBrewfatherReadings(batchId: string): Promise<any[]> {
  const BREWFATHER_USER_ID = Deno.env.get('BREWFATHER_USER_ID');
  const BREWFATHER_API_KEY = Deno.env.get('BREWFATHER_API_KEY');
  if (!BREWFATHER_USER_ID || !BREWFATHER_API_KEY) throw new Error('Brewfather credentials not configured');

  const res = await fetch(
    `https://api.brewfather.app/v2/batches/${encodeURIComponent(batchId)}/readings`,
    {
      headers: { 'Authorization': `Basic ${btoa(`${BREWFATHER_USER_ID}:${BREWFATHER_API_KEY}`)}` },
      signal: AbortSignal.timeout(15000),
    }
  );
  if (!res.ok) throw new Error(`Brewfather API error: ${res.status}`);
  return res.json();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Starting unified quick sync (RAPT + Brewfather readings)...');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Accept pre-fetched token from caller (e.g. full-sync-brew-data) to avoid double auth
    let passedToken: string | null = null;
    try {
      const body = await req.json();
      passedToken = body?.access_token || null;
    } catch { /* no body or invalid JSON — that's fine */ }

    // Read sync_settings once (reused by outageTask later — avoids double query)
    const { data: syncSettingsRow } = await supabase.from('sync_settings')
      .select('id, last_successful_rapt_sync_at, rapt_sync_interval, brewfather_enabled').single();
    const brewfatherEnabled = (syncSettingsRow as any)?.brewfather_enabled ?? true;

    // Update timestamp (fire-and-forget, no await needed for main flow)
    const nowIso = new Date().toISOString();
    supabase
      .from('sync_settings')
      .update({ 
        last_rapt_quick_sync_at: nowIso,
        last_sync_time: nowIso
      })
      .not('id', 'is', null)
      .then(({ error }) => { if (error) console.error('sync_settings update error:', error); });

    // ──────────────────────────────────────────────────────
    // PHASE 1: RAPT device sync (pills + controllers)
    // Non-fatal: if RAPT auth/API fails, continue with
    // Brewfather, custom brews, automation and history.
    // ──────────────────────────────────────────────────────

    let access_token: string | null = null;
    let selectedPillIds: string[] = [];
    let selectedControllerIds: string[] = [];
    let allPills: any[] = [];
    let allControllers: any[] = [];
    const pillTempMap = new Map<string, number>();
    let pillsUpdated = 0;
    let controllersUpdated = 0;
    let controllerUpdates: Record<string, any>[] = [];
    let raptFailed = false;

    // Always fetch selected devices (needed for temp history even on RAPT failure)
    console.log('Getting RAPT auth token + selected devices...');
    const [{ data: selectedPills }, { data: selectedControllers }] = await Promise.all([
      supabase.from('selected_rapt_pills').select('pill_id').eq('is_visible', true),
      supabase.from('selected_rapt_temp_controllers').select('controller_id').eq('is_visible', true),
    ]);
    selectedPillIds = selectedPills?.map(p => p.pill_id) || [];
    selectedControllerIds = selectedControllers?.map(c => c.controller_id) || [];

    try {
      // Get auth token (use passed token if available)
      access_token = passedToken || await getRaptToken();

      // Fetch ALL Pills and Controllers in parallel (inlined — no HTTP hops)
      const [fetchedPills, fetchedControllers] = await Promise.all([
        selectedPillIds.length > 0 ? fetchRaptPills(access_token) : Promise.resolve([]),
        selectedControllerIds.length > 0 ? fetchRaptControllers(access_token) : Promise.resolve([]),
      ]);
      allPills = fetchedPills;
      allControllers = fetchedControllers;

      // Build pill temperature map
      for (const pill of allPills) {
        const temp = pill.temperature ?? pill.telemetry?.[0]?.temperature;
        if (temp !== undefined && temp !== null && temp !== 0) {
          pillTempMap.set(pill.id, temp);
        }
      }

      // Update Pills — batch upsert instead of sequential updates
      if (selectedPillIds.length > 0) {
        const selectedPillsData = allPills.filter((pill: any) => selectedPillIds.includes(pill.id));
        if (selectedPillsData.length > 0) {
          const { data: existingPills } = await supabase.from('rapt_pills')
            .select('pill_id, color')
            .in('pill_id', selectedPillsData.map((p: any) => p.id));
          const existingColorMap = new Map((existingPills || []).map(p => [p.pill_id, p.color]));

          const pillUpserts = selectedPillsData.map((pill: any) => {
            const existingColor = existingColorMap.get(pill.id);
            const color = (existingColor && existingColor !== '#000000') ? existingColor : (pill.color && pill.color !== '#000000' ? pill.color : '#F5A623');
            return {
              pill_id: pill.id,
              name: pill.name || pill.id,
              color,
              battery_level: Math.round(pill.battery || 0),
              last_update: pill.lastActivityTime || pill.telemetry?.[0]?.createdOn,
              paired_device_id: pill.pairedDeviceId || null,
              updated_at: new Date().toISOString()
            };
          });
          const { error: pillUpsertErr } = await supabase.from('rapt_pills')
            .upsert(pillUpserts, { onConflict: 'pill_id', ignoreDuplicates: false });
          if (pillUpsertErr) console.error('Pill upsert error:', pillUpsertErr);
          else pillsUpdated = selectedPillsData.length;
        }
      }

      // Update Controllers with enriched pill_temp
      if (selectedControllerIds.length > 0) {
        const selectedControllersData = allControllers.filter((c: any) => selectedControllerIds.includes(c.id));

        const [{ data: activeSessions }, { data: autoCoolingSettings }, { data: existingControllers }] = await Promise.all([
          supabase.from('fermentation_sessions').select('controller_id').in('status', ['running', 'paused']),
          supabase.from('auto_cooling_settings').select('cooler_controller_id, enabled').single(),
          supabase.from('rapt_temp_controllers').select('controller_id, linked_pill_id, target_temp')
            .in('controller_id', selectedControllersData.map((c: any) => c.id)),
        ]);
        const controllersWithActiveSessions = new Set(activeSessions?.map(s => s.controller_id) || []);
        const coolerControllerId = autoCoolingSettings?.enabled ? autoCoolingSettings?.cooler_controller_id : null;
        const existingMap = new Map((existingControllers || []).map(c => [c.controller_id, c]));

        for (const controller of selectedControllersData) {
          const currentTemp = controller.temperature || controller.telemetry?.[0]?.temperature;
          const targetTemp = controller.targetTemperature;
          const lastUpdate = controller.lastActivityTime || controller.telemetry?.[0]?.createdOn;

          let pillTemp: number | null = null;
          let linkedPillId: string | null = null;
          const apiLinkedPillId = controller.controlDeviceId || controller.linkedDevice || controller.linkedDeviceId || null;
          if (apiLinkedPillId && pillTempMap.has(apiLinkedPillId)) {
            pillTemp = pillTempMap.get(apiLinkedPillId)!;
            linkedPillId = apiLinkedPillId;
          } else {
            const dbLinkedPillId = existingMap.get(controller.id)?.linked_pill_id;
            if (dbLinkedPillId && pillTempMap.has(dbLinkedPillId)) {
              pillTemp = pillTempMap.get(dbLinkedPillId)!;
              linkedPillId = dbLinkedPillId;
            } else {
              const apiPillTemp = controller.controlDeviceTemperature;
              if (apiPillTemp && apiPillTemp !== 0) pillTemp = apiPillTemp;
            }
          }

          const hasActiveSession = controllersWithActiveSessions.has(controller.id);
          const isCoolerController = controller.id === coolerControllerId;

          const updateData: Record<string, any> = {
            controller_id: controller.id,
            name: controller.name || controller.id,
            current_temp: currentTemp,
            pill_temp: pillTemp,
            cooling_enabled: controller.coolingEnabled || false,
            heating_enabled: controller.heatingEnabled || false,
            heating_utilisation: controller.heatingUtilisation || 0,
            cooling_hysteresis: controller.coolingHysteresis ?? 0.2,
            heating_hysteresis: controller.heatingHysteresis ?? 0.2,
            cooling_run_time: controller.coolingRunTime || 0,
            cooling_starts: controller.coolingStarts || 0,
            heating_run_time: controller.heatingRunTime || 0,
            heating_starts: controller.heatingStarts || 0,
            last_update: lastUpdate,
            updated_at: new Date().toISOString()
          };

          if (linkedPillId) updateData.linked_pill_id = linkedPillId;
          if (!hasActiveSession && !isCoolerController) {
            updateData.target_temp = targetTemp;
          } else {
            updateData.target_temp = existingMap.get(controller.id)?.target_temp ?? targetTemp;
          }

          controllerUpdates.push(updateData);
          controllersUpdated++;
        }

        if (controllerUpdates.length > 0) {
          const { error: upsertError } = await supabase.from('rapt_temp_controllers')
            .upsert(controllerUpdates, { onConflict: 'controller_id', ignoreDuplicates: false });
          if (upsertError) throw upsertError;
        }
      }

      console.log(`RAPT sync: ${pillsUpdated} pills, ${controllersUpdated} controllers`);
    } catch (raptError) {
      raptFailed = true;
      console.error('RAPT sync failed (non-fatal, continuing with remaining tasks):', raptError);
    }

    // ──────────────────────────────────────────────────────
    // PHASE 2: Brewfather readings (quick) + automation
    //          Run in parallel with custom brews
    // ──────────────────────────────────────────────────────

    // Fetch visible Brewfather brews (skip if Brewfather disabled)
    const { data: selectedBrews } = brewfatherEnabled
      ? await supabase.from('selected_brews')
          .select('batch_id').eq('is_visible', true).not('batch_id', 'like', 'custom\\_%')
      : { data: [] as any[] };

    let brewsUpdated = 0;
    // Collect pending snapshot jobs from brewfatherSync for execution in Phase 2c
    const pendingSnapshots: { brewId: string; controllerId: string | null; sgData: any[] }[] = [];

    const brewfatherSync = async () => {
      if (!selectedBrews || selectedBrews.length === 0) return;

      // Fetch readings (inlined) + existing data in parallel
      // Single batch query for all existing brews (replaces N individual queries)
      const batchIds = selectedBrews.map(b => b.batch_id);
      const [readingsResults, { data: existingBrewsArray }] = await Promise.all([
        Promise.all(selectedBrews.map(brew =>
          fetchBrewfatherReadings(brew.batch_id)
            .then(data => ({ batchId: brew.batch_id, data, error: null }))
            .catch(err => ({ batchId: brew.batch_id, data: [], error: err }))
        )),
        supabase.from('brew_readings')
          .select('id, batch_id, original_gravity, final_gravity, style, name, status, batch_number, sg_data, current_sg, current_temp, attenuation, abv, last_update, battery, linked_controller_id')
          .in('batch_id', batchIds)
      ]);

      const existingBrewsMap = new Map((existingBrewsArray || []).map((b: any) => [b.batch_id, b]));

      const brewUpdates = readingsResults.map(result => {
        if (result.error) { console.error(`Readings error for ${result.batchId}:`, result.error); return null; }
        const readings = result.data || [];
        const existingBrew = existingBrewsMap.get(result.batchId);

        const sgData = readings.filter((r: any) => r.sg && r.temp)
          .map((r: any) => ({ date: new Date(r.time).toISOString(), value: r.sg, temp: r.temp }))
          .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

        const readingsWithSG = readings.filter((r: any) => r.sg)
          .sort((a: any, b: any) => new Date(a.time).getTime() - new Date(b.time).getTime());
        const latestReading = readingsWithSG.length > 0 ? readingsWithSG[readingsWithSG.length - 1] : null;
        const currentSG = latestReading?.sg || existingBrew?.original_gravity || 1.050;
        const currentTemp = latestReading?.temp || 20;
        const battery = latestReading?.battery ? Math.round(latestReading.battery) : null;
        const og = existingBrew?.original_gravity || 1.050;

        const attenuation = ((og - currentSG) / (og - 1.000)) * 100;
        const abv = ((og - currentSG) * 131.25) || 0;

        const newData: any = {
          batch_id: result.batchId,
          current_sg: currentSG, current_temp: currentTemp,
          attenuation: Math.round(attenuation), abv: parseFloat(abv.toFixed(1)),
          last_update: latestReading ? new Date(latestReading.time).toISOString() : null,
          battery, sg_data: sgData.length > 0 ? sgData : existingBrew?.sg_data || [],
          ...(existingBrew && {
            name: existingBrew.name, style: existingBrew.style, status: existingBrew.status,
            batch_number: existingBrew.batch_number, original_gravity: existingBrew.original_gravity,
            final_gravity: existingBrew.final_gravity
          })
        };

        if (existingBrew) {
          const hasChanged = existingBrew.current_sg !== newData.current_sg ||
            existingBrew.current_temp !== newData.current_temp ||
            existingBrew.last_update !== newData.last_update ||
            JSON.stringify(existingBrew.sg_data) !== JSON.stringify(newData.sg_data);
          if (!hasChanged) return null;
        }
        return newData;
      }).filter(Boolean);

      if (brewUpdates.length > 0) {
        const { error: upsertError } = await supabase.from('brew_readings')
          .upsert(brewUpdates, { onConflict: 'batch_id' });
        if (upsertError) throw upsertError;
        brewsUpdated = brewUpdates.length;
        console.log(`Brewfather quick sync: ${brewsUpdated} brews updated`);

        // Collect snapshot jobs for Phase 2c (after automation)
        for (const u of brewUpdates) {
          const status = (u as any).status || '';
          if ((status === 'Jäsning' || status === 'Fermenting') && (u as any).sg_data?.length > 0) {
            const existingBrew = existingBrewsMap.get((u as any).batch_id);
            if (existingBrew?.id) {
              pendingSnapshots.push({
                brewId: existingBrew.id,
                controllerId: existingBrew.linked_controller_id,
                sgData: (u as any).sg_data,
              });
            }
          }
        }
      }
    };

    // PHASE 2a: Sync all data sources in parallel (RAPT already done in Phase 1)
    // Pass access_token + pill/controller data to sync-custom-brew-pills to avoid duplicate auth + DB queries
    const pillDataForCustomBrews = (allPills || [])
      .filter((p: any) => selectedPillIds.includes(p.id))
      .map((p: any) => ({
        pill_id: p.id,
        name: p.name || p.id,
        paired_device_id: p.pairedDeviceId || null,
      }));
    const controllerDataForCustomBrews = selectedControllerIds.length > 0
      ? (controllerUpdates || []).map((c: any) => ({
          controller_id: c.controller_id,
          linked_pill_id: c.linked_pill_id || null,
          pill_temp: c.pill_temp ?? null,
          current_temp: c.current_temp ?? null,
          target_temp: c.target_temp ?? null,
          profile_target_temp: c.profile_target_temp ?? null,
        }))
      : [];

    const [bfResult, customBrewResult] = await Promise.allSettled([
      brewfatherSync(),
      supabase.functions.invoke('sync-custom-brew-pills', {
        body: { access_token, pills: pillDataForCustomBrews, controllers: controllerDataForCustomBrews }
      }),
    ]);

    if (bfResult.status === 'rejected') console.error('Brewfather sync error:', bfResult.reason);
    if (customBrewResult.status === 'rejected') console.error('Custom brew sync error:', customBrewResult.reason);

    const customBrewsUpdated = customBrewResult.status === 'fulfilled' && !customBrewResult.value?.error
      ? customBrewResult.value?.data?.brewsUpdated || 0 : 0;

    // Collect pending snapshots from custom brew sync response
    if (customBrewResult.status === 'fulfilled' && customBrewResult.value?.data?.pendingSnapshots) {
      for (const s of customBrewResult.value.data.pendingSnapshots) {
        pendingSnapshots.push(s);
      }
    }

    // PHASE 2b: Run automation AFTER all data is synced (SSOT principle)
    // Automation uses cached DB data, so it can run even without fresh RAPT data
    console.log('All data synced — running automation...');
    let automationResult = null;
    try {
      const autoResponse = await supabase.functions.invoke('run-automation', {
        body: { rapt_access_token: access_token }
      });
      if (autoResponse.error) console.error('Automation error:', autoResponse.error);
      else automationResult = autoResponse.data;
    } catch (autoErr) {
      console.error('Automation error:', autoErr);
    }

    // PHASE 2c: Log temp history + outage detection + snapshots in PARALLEL after automation
    // All are independent. Temp history needs PID-adjusted values (hence after automation).
    // Snapshots use finalized controller state (after PID), ensuring correct Ctrl/Mål/PID values.
    console.log('Logging temp history + outage detection + snapshots (parallel)...');

    const tempHistoryTask = async () => {
      // Reuse selectedControllerIds from Phase 1 — no need to re-query selected_rapt_temp_controllers
      if (selectedControllerIds.length === 0) return;

      const { data: controllers } = await supabase
        .from('rapt_temp_controllers')
        .select('controller_id, pill_temp, current_temp, target_temp, cooling_enabled, profile_target_temp')
        .in('controller_id', selectedControllerIds);

      if (!controllers || controllers.length === 0) return;

      // Insert temp history + delta history in parallel
      const historyRecords = controllers.map(c => ({
        controller_id: c.controller_id,
        current_temp: c.current_temp ?? c.pill_temp,
        target_temp: c.target_temp,
        cooling_enabled: c.cooling_enabled || false,
        profile_target_temp: c.profile_target_temp ?? c.target_temp,
      }));

      const deltaRecords = controllers
        .filter(c => c.pill_temp !== null && c.current_temp !== null)
        .map(c => ({
          controller_id: c.controller_id,
          pill_temp: c.pill_temp,
          controller_temp: c.current_temp,
          delta: c.pill_temp - c.current_temp,
        }));

      const inserts: Promise<any>[] = [
        supabase.from('temp_controller_history').insert(historyRecords),
      ];
      if (deltaRecords.length > 0) {
        inserts.push(supabase.from('temp_delta_history').insert(deltaRecords));
      }

      const results = await Promise.allSettled(inserts);
      for (const r of results) {
        if (r.status === 'rejected') console.error('History insert error:', r.reason);
      }
      console.log(`Recorded temp history for ${controllers.length} controllers`);
    };

    const outageTask = async () => {
      // Reuse syncSettingsRow read from start of function (no extra DB query)
      const lastSuccess = syncSettingsRow?.last_successful_rapt_sync_at;
      const now = new Date();
      if (lastSuccess) {
        const gap = (now.getTime() - new Date(lastSuccess).getTime()) / 1000;
        const threshold = (syncSettingsRow?.rapt_sync_interval || 300) * 2;
        if (gap > threshold) {
          await supabase.from('rapt_outage_log').insert({
            outage_start: lastSuccess, outage_end: now.toISOString(), duration_seconds: Math.round(gap)
          });
        }
      }
      // Only mark successful if RAPT actually synced
      if (syncSettingsRow?.id && !raptFailed) {
        await supabase.from('sync_settings').update({ last_successful_rapt_sync_at: now.toISOString() }).eq('id', syncSettingsRow.id);
      }
    };

    const snapshotTask = async () => {
      if (pendingSnapshots.length === 0) return;
      console.log(`Creating ${pendingSnapshots.length} brew snapshot(s) (post-automation)...`);
      for (const s of pendingSnapshots) {
        await createBrewSnapshots(supabase, s.brewId, s.controllerId, s.sgData);
      }
    };

    const [histResult, outageResult, snapResult] = await Promise.allSettled([tempHistoryTask(), outageTask(), snapshotTask()]);
    if (histResult.status === 'rejected') console.error('Temp history error:', histResult.reason);
    if (outageResult.status === 'rejected') console.error('Outage log error:', outageResult.reason);
    if (snapResult.status === 'rejected') console.error('Snapshot error:', snapResult.reason);

    const raptStatus = raptFailed ? ' (RAPT FAILED — degraded mode)' : '';
    console.log(`Unified quick sync complete${raptStatus}: ${pillsUpdated} pills, ${controllersUpdated} controllers, ${brewsUpdated} brews, ${customBrewsUpdated} custom brews`);

    return new Response(
      JSON.stringify({ success: true, raptFailed, pillsUpdated, controllersUpdated, brewsUpdated, customBrewsUpdated, automation: automationResult }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in sync-rapt-data-quick:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
