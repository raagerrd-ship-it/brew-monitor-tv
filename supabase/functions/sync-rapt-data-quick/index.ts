import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { createBrewSnapshot } from '../_shared/brew-snapshots.ts';
import { standardSgCorrection, applySgCorrection, processSgCalibration, getLearnedResidual } from '../_shared/sg-temp-correction.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// ── Inlined RAPT auth with DB token cache ──
async function getRaptToken(supabase?: any): Promise<string> {
  // Try cached token first (valid if expires > 2 min from now)
  if (supabase) {
    try {
      const { data: cached } = await supabase
        .from('rapt_token_cache')
        .select('access_token, expires_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cached?.access_token && cached?.expires_at) {
        const expiresAt = new Date(cached.expires_at).getTime();
        if (expiresAt > Date.now() + 10 * 60 * 1000) {
          console.log('🔑 Using cached RAPT token (expires in ' + Math.round((expiresAt - Date.now()) / 60000) + 'min)');
          return cached.access_token;
        }
      }
    } catch (e) { console.log('Token cache read failed, authenticating fresh'); }
  }

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

  // Cache the new token
  if (supabase && data.expires_in) {
    const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
    supabase.from('rapt_token_cache')
      .upsert({ id: '00000000-0000-0000-0000-000000000001', access_token: data.access_token, expires_at: expiresAt }, { onConflict: 'id' })
      .then(({ error }: any) => { if (error) console.error('Token cache write failed:', error); });
    console.log('🔑 Fresh RAPT token cached (expires in ' + Math.round(data.expires_in / 60) + 'min)');
  }

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

// ── Inlined Brewfather readings fetch — returns SG-corrected values ──
async function fetchBrewfatherReadings(batchId: string, sgCorrectionEnabled: boolean): Promise<any[]> {
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
  const readings = await res.json();
  if (sgCorrectionEnabled) {
    for (const r of readings) {
      if (r.sg && r.temp) r.sg = standardSgCorrection(r.sg, r.temp);
    }
  }
  return readings;
}

// ── Inlined RAPT pill telemetry fetch — returns SG-corrected values ──
// Applies standard correction + pill-specific residual at source.
async function fetchPillTelemetryCorrected(
  accessToken: string, pillId: string, startDate: string, endDate: string,
  supabase: any, sgCorrectionEnabled: boolean
): Promise<TelemetryRecord[]> {
  const apiBaseUrl = Deno.env.get('RAPT_API_BASE_URL') || 'https://api.rapt.io';
  const params = new URLSearchParams({ hydrometerId: pillId, startDate, endDate });
  const res = await fetch(`${apiBaseUrl}/api/Hydrometers/GetTelemetry?${params}`, {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`RAPT telemetry API error: ${res.status} ${errText}`);
  }
  const raw: TelemetryRecord[] = await res.json();
  
  if (sgCorrectionEnabled) {
    // Get learned pill-specific residual — only apply if confident
    let pillResidual = 0;
    let shouldCorrect = false;
    try {
      const { residualPerDegree, confident, sampleCount } = await getLearnedResidual(supabase, pillId);
      pillResidual = residualPerDegree;
      shouldCorrect = confident;
      if (!confident) {
        console.log(`⏳ SG correction skipped for pill ${pillId}: only ${sampleCount} samples (need 10+)`);
      }
    } catch (_e) { /* no correction yet */ }
    
    if (shouldCorrect) {
      // Apply full SG correction (standard + residual) at source
      for (const t of raw) {
        const rawSg = t.gravity / 1000;
        t.gravity = applySgCorrection(rawSg, t.temperature, pillResidual) * 1000;
      }
    }
  }
  return raw;
}

interface TelemetryRecord {
  createdOn: string;
  gravity: number;
  temperature: number;
  battery: number;
}

import type { SgDataPoint } from '../_shared/types.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const syncStartTime = Date.now();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── Concurrency guard: skip if another sync ran <30s ago ──
    const { data: recentLog } = await supabase
      .from('auto_cooling_decision_logs')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recentLog?.created_at) {
      const secsSinceLast = (Date.now() - new Date(recentLog.created_at).getTime()) / 1000;
      if (secsSinceLast < 30) {
        console.log(`⏭️ Skipping sync — last ran ${secsSinceLast.toFixed(0)}s ago`);
        return new Response(JSON.stringify({ skipped: 'concurrent', seconds_since_last: Math.round(secsSinceLast) }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    console.log('Starting unified quick sync (RAPT + Brewfather readings)...');

    // Accept pre-fetched token from caller (e.g. full-sync-brew-data) to avoid double auth
    let passedToken: string | null = null;
    try {
      const body = await req.json();
      passedToken = body?.access_token || null;
    } catch { /* no body or invalid JSON — that's fine */ }

    // Read sync_settings + auto_cooling_settings once
    const [{ data: syncSettingsRow }, { data: autoCoolingRow }] = await Promise.all([
      supabase.from('sync_settings')
        .select('id, last_successful_rapt_sync_at, rapt_sync_interval, brewfather_enabled').single(),
      supabase.from('auto_cooling_settings')
        .select('sg_temp_correction_enabled').limit(1).maybeSingle(),
    ]);
    const brewfatherEnabled = (syncSettingsRow as any)?.brewfather_enabled ?? true;
    const sgTempCorrectionEnabled = (autoCoolingRow as any)?.sg_temp_correction_enabled ?? false;

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
    let raptFailedPhase = '';
    let tPhase1Auth = 0, tPhase1Fetch = 0, tPhase1Upsert = 0;

    // Fetch selected devices (always needed) AND auth in parallel
    const tPhase1 = Date.now();
    console.log('Getting RAPT auth token + selected devices (parallel)...');

    // DB queries always succeed; auth may fail — use allSettled pattern
    const tAuth = Date.now();
    const [{ data: selectedPills }, { data: selectedControllers }] = await Promise.all([
      supabase.from('selected_rapt_pills').select('pill_id').eq('is_visible', true),
      supabase.from('selected_rapt_temp_controllers').select('controller_id').eq('is_visible', true),
    ]);
    selectedPillIds = selectedPills?.map(p => p.pill_id) || [];
    selectedControllerIds = selectedControllers?.map(c => c.controller_id) || [];

    try {
      raptFailedPhase = '1a auth';
      access_token = passedToken || await getRaptToken(supabase);
      tPhase1Auth = Date.now() - tAuth;
      console.log(`  ⏱️ Phase 1a (auth): ${tPhase1Auth}ms`);

      // Fetch ALL Pills and Controllers in parallel (inlined — no HTTP hops)
      raptFailedPhase = '1b fetch';
      const tFetch = Date.now();
      const [fetchedPills, fetchedControllers] = await Promise.all([
        selectedPillIds.length > 0 ? fetchRaptPills(access_token) : Promise.resolve([]),
        selectedControllerIds.length > 0 ? fetchRaptControllers(access_token) : Promise.resolve([]),
      ]);
      tPhase1Fetch = Date.now() - tFetch;
      console.log(`  ⏱️ Phase 1b (fetch pills+controllers): ${tPhase1Fetch}ms`);
      raptFailedPhase = '1c upsert';
      const tUpsertStart = Date.now();
      allPills = fetchedPills;
      allControllers = fetchedControllers;

      // Build pill temperature map (used to enrich controllers with pill_temp in Phase 1)
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
          // Fetch existing pill colors to preserve user overrides
          const { data: existingPills } = await supabase.from('rapt_pills')
            .select('pill_id, color')
            .in('pill_id', selectedPillsData.map((p: any) => p.id));
          const existingColorMap = new Map<string, string>();
          for (const ep of (existingPills || [])) {
            if (ep.color) existingColorMap.set(ep.pill_id, ep.color);
          }

          const pillUpserts = selectedPillsData.map((pill: any) => {
            // Preserve user-set color; only use API color for brand-new pills
            const existingColor = existingColorMap.get(pill.id);
            const apiColor = pill.color && pill.color !== '#000000' ? pill.color : '#F5A623';
            return {
              pill_id: pill.id,
              name: pill.name || pill.id,
              color: existingColor || apiColor,
              battery_level: Math.round(pill.battery || 0),
              gravity: pill.gravity ?? pill.telemetry?.[0]?.gravity ?? null,
              temperature: pill.temperature ?? pill.telemetry?.[0]?.temperature ?? null,
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
          supabase.from('auto_cooling_settings').select('cooler_controller_id, enabled, pill_compensation_enabled').single(),
          supabase.from('rapt_temp_controllers').select('controller_id, linked_pill_id, target_temp')
            .in('controller_id', selectedControllersData.map((c: any) => c.id)),
        ]);
        const controllersWithActiveSessions = new Set(activeSessions?.map(s => s.controller_id) || []);
        const coolerControllerId = autoCoolingSettings?.enabled ? autoCoolingSettings?.cooler_controller_id : null;
        const isPillCompEnabled = autoCoolingSettings?.enabled && autoCoolingSettings?.pill_compensation_enabled;
        const existingMap = new Map((existingControllers || []).map(c => [c.controller_id, c]));
        const manualChangeDetections: { controllerId: string; controllerName: string; hardwareTarget: number; dbTarget: number; source: string }[] = [];

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
          // Preserve DB target_temp for controllers managed by automation:
          // - Active fermentation session (profile controls target)
          // - Cooler controller (cooler management controls target)
          // - PID pill-compensation enabled + controller has pill (PID controls target)
          const isPidManaged = isPillCompEnabled && pillTemp != null;
          if (!hasActiveSession && !isCoolerController && !isPidManaged) {
            updateData.target_temp = targetTemp;
          } else {
            const preservedTarget = existingMap.get(controller.id)?.target_temp ?? targetTemp;

            // Detect manual hardware changes on managed controllers
            if (targetTemp != null && Math.abs(preservedTarget - targetTemp) >= 0.1) {
              const controllerLabel = controller.name || controller.id;
              const source = isCoolerController ? 'kylare' : isPidManaged ? 'PID' : 'profil';

              // Check if this "change" is just RAPT API latency from a recent PID/automation adjustment.
              // If the hardware value matches the old or new target of a recent adjustment, skip.
              const { data: recentAdj } = await supabase
                .from('auto_cooling_adjustments')
                .select('old_target_temp, new_target_temp')
                .eq('cooler_controller_id', controller.id)
                .gte('created_at', new Date(Date.now() - 20 * 60 * 1000).toISOString())
                .order('created_at', { ascending: false })
                .limit(1);

              const isAutomationLatency = recentAdj?.[0] && (
                Math.abs(targetTemp - recentAdj[0].old_target_temp) < 0.15 ||
                Math.abs(targetTemp - recentAdj[0].new_target_temp) < 0.15
              );

              if (isAutomationLatency) {
                console.log(`SYNC_SKIP_FALSE_MANUAL: ${controllerLabel}: Hårdvara ${targetTemp}°C matchar senaste automation (old=${recentAdj![0].old_target_temp}, new=${recentAdj![0].new_target_temp}), ignorerar`);
                updateData.target_temp = preservedTarget; // Keep DB value
              } else {
                console.log(`SYNC_MANUAL_CHANGE: ${controllerLabel}: Hårdvara ändrad till ${targetTemp}°C (DB: ${preservedTarget}°C) — ${source}-hanterad`);

                // Accept the hardware value so the change is only logged once
                updateData.target_temp = targetTemp;
                if (isCoolerController) {
                  updateData.profile_target_temp = targetTemp;
                }

                // Log as manual adjustment so it appears in decision history
                manualChangeDetections.push({
                  controllerId: controller.id,
                  controllerName: controllerLabel,
                  hardwareTarget: targetTemp,
                  dbTarget: preservedTarget,
                  source,
                });
              }
            } else {
              updateData.target_temp = preservedTarget;
            }
          }

          controllerUpdates.push(updateData);
          controllersUpdated++;
        }

        if (controllerUpdates.length > 0) {
          const { error: upsertError } = await supabase.from('rapt_temp_controllers')
            .upsert(controllerUpdates, { onConflict: 'controller_id', ignoreDuplicates: false });
          if (upsertError) throw upsertError;
        }

        // Log detected manual hardware changes to adjustment history
        for (const mc of manualChangeDetections) {
          await supabase.from('auto_cooling_adjustments').insert({
            cooler_controller_id: mc.controllerId,
            cooler_controller_name: mc.controllerName,
            old_target_temp: mc.dbTarget,
            new_target_temp: mc.hardwareTarget,
            lowest_followed_temp: mc.hardwareTarget,
            reason: `🔧 Manuell hårdvaruändring detekterad: ${mc.dbTarget.toFixed(1)}° → ${mc.hardwareTarget.toFixed(1)}° (${mc.source}-hanterad, automation bevarar DB-värde)`,
            original_target_temp: mc.hardwareTarget,
            followed_controller_name: mc.controllerName,
          });
          console.log(`SYNC_MANUAL_LOGGED: ${mc.controllerName}: Loggade manuell ändring ${mc.dbTarget}° → ${mc.hardwareTarget}°`);
        }
      }

      tPhase1Upsert = Date.now() - tUpsertStart;
      console.log(`  ⏱️ Phase 1c (upsert): ${tPhase1Upsert}ms`);
      console.log(`⏱️ Phase 1 (RAPT total): ${Date.now() - tPhase1}ms`);
      console.log(`RAPT sync: ${pillsUpdated} pills, ${controllersUpdated} controllers`);
    } catch (raptError) {
      raptFailed = true;
      console.log(`⏱️ Phase 1 (RAPT FAILED in ${raptFailedPhase}): ${Date.now() - tPhase1}ms`);
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

    const brewfatherSync = async () => {
      if (!selectedBrews || selectedBrews.length === 0) return;

      // Fetch readings (inlined) + existing data in parallel
      // Single batch query for all existing brews (replaces N individual queries)
      const batchIds = selectedBrews.map(b => b.batch_id);
      const [readingsResults, { data: existingBrewsArray }] = await Promise.all([
        Promise.all(selectedBrews.map(brew =>
          fetchBrewfatherReadings(brew.batch_id, sgTempCorrectionEnabled)
            .then(data => ({ batchId: brew.batch_id, data, error: null }))
            .catch(err => ({ batchId: brew.batch_id, data: [], error: err }))
        )),
        supabase.from('brew_readings')
          .select('id, batch_id, original_gravity, final_gravity, style, name, status, batch_number, sg_data, current_sg, current_temp, attenuation, abv, last_update, battery, linked_controller_id, linked_pill_id')
          .in('batch_id', batchIds)
      ]);

      const existingBrewsMap = new Map((existingBrewsArray || []).map((b: any) => [b.batch_id, b]));

      const brewUpdates = readingsResults.map(result => {
        if (result.error) { console.error(`Readings error for ${result.batchId}:`, result.error); return null; }
        const readings = result.data || [];
        const existingBrew = existingBrewsMap.get(result.batchId);

        // SG values are already temp-corrected at fetch time
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

        // Snapshots are created in snapshotTask (Phase 2c) by reading from DB
      }
    };

    // PHASE 2a: Sync all data sources in parallel (RAPT already done in Phase 1)
    // Both Brewfather and custom brews read pill/controller data from DB (written in Phase 1)

    let customBrewsUpdated = 0;

    const customBrewSync = async () => {
      const { data: customBrews } = await supabase
        .from('brew_readings')
        .select('*')
        .like('batch_id', 'custom\\_%')
        .in('status', ['Jäsning', 'Fermenting']);

      if (!customBrews || customBrews.length === 0) return;
      console.log(`Found ${customBrews.length} custom brews in fermentation`);

      // Read pills + controllers from DB (Phase 1 already wrote fresh data)
      const [{ data: dbPills }, { data: dbControllers }] = await Promise.all([
        supabase.from('rapt_pills').select('pill_id, name, paired_device_id'),
        supabase.from('rapt_temp_controllers').select('controller_id, linked_pill_id, pill_temp, current_temp, target_temp, profile_target_temp'),
      ]);
      const dbCtrlMap = new Map((dbControllers || []).map((c: any) => [c.controller_id, c]));

      for (const brew of customBrews) {
        try {
          let pillId = brew.linked_pill_id;
          
          if (!pillId && brew.linked_controller_id) {
            const controller = dbCtrlMap.get(brew.linked_controller_id);
            if (controller?.linked_pill_id) pillId = controller.linked_pill_id;
          }

          if (!pillId) {
            for (const pill of (dbPills || [])) {
              if (!pill.paired_device_id) continue;
              const controller = dbCtrlMap.get(pill.paired_device_id);
              if (controller?.pill_temp != null && Math.abs(controller.pill_temp - brew.current_temp) <= 3) {
                pillId = pill.pill_id;
                console.log(`Auto-matched pill ${pill.name} to brew ${brew.name} via paired_device_id + temp matching`);
                break;
              }
            }
          }
          
          if (!pillId) {
            console.log(`No pill_id available for brew ${brew.name}, skipping`);
            continue;
          }

          const endDate = new Date();
          let startDate: Date;
          const existingSgData: SgDataPoint[] = Array.isArray(brew.sg_data) ? brew.sg_data : [];
          const hasNoData = existingSgData.length === 0;
          
          if (hasNoData) {
            if (brew.fermentation_start) {
              startDate = new Date(brew.fermentation_start);
            } else {
              const brewCreatedDate = new Date(brew.created_at);
              const thirtyDaysAgo = new Date();
              thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
              startDate = brewCreatedDate < thirtyDaysAgo ? thirtyDaysAgo : brewCreatedDate;
            }
          } else if (brew.fermentation_start) {
            startDate = brew.last_update ? new Date(brew.last_update) : new Date(brew.fermentation_start);
            if (brew.last_update) startDate.setMinutes(startDate.getMinutes() - 5);
          } else if (brew.last_update) {
            startDate = new Date(brew.last_update);
            startDate.setMinutes(startDate.getMinutes() - 5);
          } else {
            startDate = new Date();
            startDate.setDate(startDate.getDate() - 7);
          }

          if (!access_token) {
            console.log(`No RAPT token available for custom brew ${brew.name}, skipping`);
            continue;
          }

          let telemetryData: any[];
          try {
            telemetryData = await fetchPillTelemetryCorrected(access_token, pillId, startDate.toISOString(), endDate.toISOString(), supabase, sgTempCorrectionEnabled);
          } catch (telemetryError) {
            console.error(`Failed to fetch telemetry for brew ${brew.name}:`, telemetryError);
            continue;
          }

          if (!telemetryData || !Array.isArray(telemetryData) || telemetryData.length === 0) {
            if (brew.linked_controller_id) {
              const ctrlFull = dbCtrlMap.get(brew.linked_controller_id);
              if (ctrlFull?.current_temp != null) {
                await supabase.from('brew_readings')
                  .update({ current_temp: ctrlFull.current_temp, updated_at: new Date().toISOString() })
                  .eq('id', brew.id);
                console.log(`Updated ${brew.name} with controller probe temp: ${ctrlFull.current_temp}°C`);
                customBrewsUpdated++;
              }
            }
            continue;
          }

          const fermentationStartDate = brew.fermentation_start ? new Date(brew.fermentation_start) : null;
          const newSgData: SgDataPoint[] = telemetryData
            .map((t: TelemetryRecord) => ({ date: new Date(t.createdOn).toISOString(), value: t.gravity / 1000, temp: t.temperature }))
            .filter((d: SgDataPoint) => {
              if (d.value < 0.990 || d.value > 1.200) return false;
              if (fermentationStartDate && new Date(d.date) < fermentationStartDate) return false;
              return true;
            });

          const existingDates = new Set(existingSgData.map(d => d.date));
          const uniqueNewData = newSgData.filter(d => !existingDates.has(d.date));
          const mergedSgData = [...existingSgData, ...uniqueNewData]
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

          if (mergedSgData.length === 0) continue;

          const firstData = mergedSgData[0];
          const latestData = mergedSgData[mergedSgData.length - 1];
          const latestTelemetry = telemetryData[telemetryData.length - 1] as TelemetryRecord;
          
          let og = brew.original_gravity;
          if (hasNoData && firstData.value >= 1.030 && firstData.value <= 1.150) {
            og = firstData.value;
            console.log(`Auto-updating OG for ${brew.name} from ${brew.original_gravity} to ${og} (initial sync)`);
          }
          
          const currentSg = latestData.value;
          const attenuation = og > 1 ? Math.round(((og - currentSg) / (og - 1)) * 100) : 0;
          const abv = og > 1 ? Number(((og - currentSg) * 131.25).toFixed(1)) : 0;

          const { error: updateError } = await supabase
            .from('brew_readings')
            .update({
              sg_data: mergedSgData, current_sg: currentSg, current_temp: latestData.temp,
              original_gravity: og, attenuation: Math.max(0, Math.min(100, attenuation)),
              abv: Math.max(0, abv), battery: latestTelemetry.battery,
              last_update: latestData.date, updated_at: new Date().toISOString()
            })
            .eq('id', brew.id);

          if (updateError) { console.error(`Failed to update brew ${brew.name}:`, updateError); continue; }
          console.log(`Updated custom brew ${brew.name} with ${uniqueNewData.length} new data points`);
          customBrewsUpdated++;
          
          // Snapshots are created in snapshotTask (Phase 2c) by reading from DB

          if (sgTempCorrectionEnabled) {
            try {
              await processSgCalibration(supabase, pillId, mergedSgData);
            } catch (calErr) {
              console.error(`SG calibration error for pill ${pillId}:`, calErr);
            }
          }

        } catch (brewError) {
          console.error(`Error processing brew ${brew.name}:`, brewError);
        }
      }
    };

    const tPhase2a = Date.now();
    const [bfResult, customBrewResult] = await Promise.allSettled([
      brewfatherSync(),
      customBrewSync(),
    ]);
    console.log(`⏱️ Phase 2a (Brewfather+custom): ${Date.now() - tPhase2a}ms`);

    if (bfResult.status === 'rejected') console.error('Brewfather sync error:', bfResult.reason);
    if (customBrewResult.status === 'rejected') console.error('Custom brew sync error:', customBrewResult.reason);

    // PHASE 2b: Run automation AFTER all data is synced (SSOT principle)
    // Skip entirely when system is idle (no active sessions, no active cooling, cooler at max)
    const [{ data: activeSessCheck }, { data: autoCoolingCheck2 }] = await Promise.all([
      supabase.from('fermentation_sessions').select('id').in('status', ['running', 'paused']).limit(1),
      supabase.from('auto_cooling_settings').select('enabled, pill_compensation_enabled, cooler_controller_id').limit(1).maybeSingle(),
    ]);
    const hasActiveSessions2 = activeSessCheck && activeSessCheck.length > 0;
    const hasCoolingEnabled = autoCoolingCheck2?.enabled === true;
    const hasPillComp = autoCoolingCheck2?.pill_compensation_enabled === true;

    // Check if cooler is idle (at max temp)
    let coolerIsIdle2 = true;
    if (hasCoolingEnabled && autoCoolingCheck2?.cooler_controller_id) {
      const { data: coolerCtrl } = await supabase.from('rapt_temp_controllers')
        .select('target_temp, max_target_temp')
        .eq('controller_id', autoCoolingCheck2.cooler_controller_id).maybeSingle();
      if (coolerCtrl) {
        const ct = parseFloat(String(coolerCtrl.target_temp ?? 0));
        const cm = parseFloat(String(coolerCtrl.max_target_temp ?? 25));
        coolerIsIdle2 = Math.abs(ct - cm) <= 0.5;
      }
    }

    // PID only matters if there are active sessions — no sessions = nothing to compensate
    const systemIsIdle = !hasActiveSessions2 && (!hasCoolingEnabled || coolerIsIdle2);

    let automationResult = null;
    const tPhase2b = Date.now();

    if (systemIsIdle) {
      console.log('⏱️ Phase 2b (automation): SKIPPED — system idle');
    } else {
      console.log('All data synced — running automation...');

      // Build brew_sg_data map from already-synced brew data (avoids redundant DB queries in automation)
      const brew_sg_data: Record<string, any> = {};
      {
        const { data: allBrews } = await supabase
          .from('brew_readings')
          .select('id, name, current_sg, original_gravity, final_gravity, attenuation, current_temp, battery, status, last_update, linked_controller_id')
          .in('status', ['Jäsning', 'Fermenting']);

        if (allBrews) {
          for (const brew of allBrews) {
            if (brew.linked_controller_id) {
              brew_sg_data[brew.linked_controller_id] = {
                brew_id: brew.id, name: brew.name, current_sg: brew.current_sg,
                og: brew.original_gravity, fg: brew.final_gravity, attenuation: brew.attenuation,
                pill_temp: brew.current_temp, battery: brew.battery, status: brew.status,
                last_update: brew.last_update,
              };
            }
          }
        }
        console.log(`Collected brew_sg_data for ${Object.keys(brew_sg_data).length} controller(s)`);
      }

      try {
        const autoResponse = await supabase.functions.invoke('run-automation', {
          body: { rapt_access_token: access_token, brew_sg_data }
        });
        if (autoResponse.error) console.error('Automation error:', autoResponse.error);
        else automationResult = autoResponse.data;
      } catch (autoErr) {
        console.error('Automation error:', autoErr);
      }
      console.log(`⏱️ Phase 2b (automation): ${Date.now() - tPhase2b}ms`);
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
        .select('controller_id, pill_temp, current_temp, target_temp, cooling_enabled, profile_target_temp, cooling_run_time')
        .in('controller_id', selectedControllerIds);

      if (!controllers || controllers.length === 0) return;

      // Insert temp history + delta history in parallel
      const historyRecords = controllers.map(c => ({
        controller_id: c.controller_id,
        current_temp: c.current_temp ?? c.pill_temp,
        target_temp: c.target_temp,
        cooling_enabled: c.cooling_enabled || false,
        profile_target_temp: c.profile_target_temp ?? c.target_temp,
        cooling_run_time: c.cooling_run_time ?? null,
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
        // Notify user if RAPT has been down >31 minutes (matches stale threshold)
        const staleThreshold = 31 * 60;
        if (raptFailed && gap >= staleThreshold) {
          const minutes = Math.round(gap / 60);
          const { insertNotification } = await import('../_shared/notifications.ts');
          await insertNotification(supabase, {
            type: 'rapt_api_degraded',
            title: 'RAPT API otillgängligt',
            body: `RAPT har inte svarat på ${minutes} minuter. Automationen kör i degraderat läge med cachad data.`,
          });
        }
      }
      // Only mark successful if RAPT actually synced
      if (syncSettingsRow?.id && !raptFailed) {
        await supabase.from('sync_settings').update({ last_successful_rapt_sync_at: now.toISOString() }).eq('id', syncSettingsRow.id);
      }
    };

    const snapshotTask = async () => {
      // Read active brews + controllers from DB (post-automation, finalized values)
      const { data: activeBrews } = await supabase
        .from('brew_readings')
        .select('id, current_sg, current_temp, last_update, linked_controller_id, status, sg_data')
        .in('status', ['Jäsning', 'Fermenting']);
      if (!activeBrews?.length) return;

      const ctrlIds = activeBrews.map((b: any) => b.linked_controller_id).filter(Boolean);
      const { data: ctrls } = ctrlIds.length > 0
        ? await supabase.from('rapt_temp_controllers')
            .select('controller_id, current_temp, profile_target_temp, last_update')
            .in('controller_id', ctrlIds)
        : { data: [] as any[] };
      const ctrlMap = new Map((ctrls || []).map((c: any) => [c.controller_id, c]));

      let count = 0;
      for (const brew of activeBrews) {
        const sgArr = Array.isArray(brew.sg_data) ? brew.sg_data as any[] : [];
        if (sgArr.length === 0) continue;
        const latest = sgArr[sgArr.length - 1];
        const ctrl = ctrlMap.get(brew.linked_controller_id);
        await createBrewSnapshot(supabase, brew.id, {
          recorded_at: ctrl?.last_update || latest.date || new Date().toISOString(),
          sg: latest.value ?? null,
          pill_temp: latest.temp ?? null,
          controller_temp: ctrl?.current_temp ?? null,
          profile_target_temp: ctrl?.profile_target_temp ?? null,
        });
        count++;
      }
      if (count > 0) console.log(`Created ${count} brew snapshot(s) (post-automation)`);
    };

    const tPhase2c = Date.now();
    const [histResult, outageResult, snapResult] = await Promise.allSettled([tempHistoryTask(), outageTask(), snapshotTask()]);
    console.log(`⏱️ Phase 2c (history+outage+snapshots): ${Date.now() - tPhase2c}ms`);
    if (histResult.status === 'rejected') console.error('Temp history error:', histResult.reason);
    if (outageResult.status === 'rejected') console.error('Outage log error:', outageResult.reason);
    if (snapResult.status === 'rejected') console.error('Snapshot error:', snapResult.reason);

    // ── Dynamic sync frequency: 5 min when active, 15 min when idle ──
    try {
      const currentInterval = syncSettingsRow?.rapt_sync_interval ?? 300;
      const [{ data: activeSessionsCheck }, { data: autoCoolingCheck }] = await Promise.all([
        supabase.from('fermentation_sessions').select('id').in('status', ['running', 'paused']).limit(1),
        supabase.from('auto_cooling_settings').select('enabled, cooler_controller_id').limit(1).maybeSingle(),
      ]);
      // Check if cooler is idling at max temp (uses cooler_controller_id from settings query above)
      let coolerController: { target_temp: number | null; max_target_temp: number | null } | null = null;
      if (autoCoolingCheck?.cooler_controller_id) {
        const { data: ctrl } = await supabase.from('rapt_temp_controllers')
          .select('target_temp, max_target_temp')
          .eq('controller_id', autoCoolingCheck.cooler_controller_id).maybeSingle();
        coolerController = ctrl;
      }
      const hasActiveSessions = activeSessionsCheck && activeSessionsCheck.length > 0;
      // Automation is "active" only if enabled AND cooler is not idling at max temp
      const coolerIsIdle = coolerController && coolerController.max_target_temp != null
        && coolerController.target_temp != null
        && coolerController.target_temp >= coolerController.max_target_temp;
      const automationEnabled = autoCoolingCheck?.enabled === true && !coolerIsIdle;
      const isActive = hasActiveSessions || automationEnabled;
      const desiredInterval = isActive ? 300 : 900;
      const reasons = [hasActiveSessions && 'sessions', automationEnabled && 'automation', coolerIsIdle && 'cooler-idle'].filter(Boolean).join('+') || 'none';
      const changed = desiredInterval !== currentInterval;
      console.log(`⏱️ Sync: ${currentInterval}s interval, active=${isActive} (${reasons})`);
      if (changed && syncSettingsRow?.id) {
        await supabase.from('sync_settings').update({ rapt_sync_interval: desiredInterval }).eq('id', syncSettingsRow.id);
        console.log(`⏱️ Sync frequency changed: ${currentInterval}s → ${desiredInterval}s`);
      }

      // Read finalized controller + pill data from DB for sync log
      const [{ data: dbControllersLog }, { data: dbPillsLog }] = await Promise.all([
        supabase.from('rapt_temp_controllers')
          .select('controller_id, name, pill_temp, current_temp, target_temp, profile_target_temp, cooling_enabled, is_glycol_cooler, last_update, linked_pill_id')
          .in('controller_id', selectedControllerIds),
        selectedPillIds.length > 0
          ? supabase.from('rapt_pills').select('pill_id, name, gravity, battery_level, temperature, last_update').in('pill_id', selectedPillIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const pillDataForLog = new Map((dbPillsLog || []).map((p: any) => [p.pill_id, p]));

      const syncDecisions: any[] = [];
      for (const cu of (dbControllersLog || [])) {
        const isGlycol = cu.is_glycol_cooler === true;
        const details: Record<string, unknown> = {
          pill_temp: cu.pill_temp != null ? Math.round(cu.pill_temp * 10) / 10 : null,
          ctrl_temp: cu.current_temp != null ? Math.round(cu.current_temp * 10) / 10 : null,
          ctrl_target: cu.target_temp != null ? Math.round(cu.target_temp * 10) / 10 : null,
          profile_target: cu.profile_target_temp != null ? Math.round(cu.profile_target_temp * 10) / 10 : null,
          cooling_enabled: cu.cooling_enabled,
          last_update: cu.last_update ? new Date(cu.last_update).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null,
        };
        if (isGlycol) details.glycol = true;
        syncDecisions.push({ step: 'SYNC_DATA', result: 'info', message: `Controller: ${cu.name}`, details });

        const linkedPillId = cu.linked_pill_id;
        const pillInfo = linkedPillId ? pillDataForLog.get(linkedPillId) : null;
        if (pillInfo) {
          syncDecisions.push({ step: 'BREW_SG_STATUS', result: 'info', message: `Controller: ${cu.name}`, details: {
            pill_name: pillInfo.name,
            current_sg: pillInfo.gravity != null ? Math.round((pillInfo.gravity > 100 ? pillInfo.gravity / 1000 : pillInfo.gravity) * 10000) / 10000 : null,
            battery: pillInfo.battery_level,
            pill_temp: pillInfo.temperature != null ? Math.round(pillInfo.temperature * 10) / 10 : null,
            last_update: pillInfo.last_update ? new Date(pillInfo.last_update).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null,
            last_update_raw: pillInfo.last_update,
          }});
        }
      }
      syncDecisions.push(
        { step: 'SYNC_FREQ', result: changed ? 'action' : 'info', message: `Intervall: ${desiredInterval / 60} min (${reasons})`, details: { currentInterval, desiredInterval, isActive, hasActiveSessions, automationEnabled, coolerIsIdle, reasons } },
      );
      const totalMs = Date.now() - syncStartTime;
      syncDecisions.push({
        step: 'PHASE_TIMINGS', result: 'info', message: 'Fas-tider',
        details: {
          '1_rapt_ms': Math.round(tPhase2a - tPhase1),
          '1a_auth_ms': tPhase1Auth,
          '1b_fetch_ms': tPhase1Fetch,
          '1c_upsert_ms': tPhase1Upsert,
          ...(raptFailed ? { '1_failed_in': raptFailedPhase } : {}),
          '2a_brew_ms': Math.round(tPhase2b - tPhase2a),
          '2b_auto_ms': Math.round(tPhase2c - tPhase2b),
          '2c_hist_ms': Math.round(totalMs - (tPhase2c - syncStartTime)),
          total_ms: totalMs,
        }
      });
      await supabase.from('auto_cooling_decision_logs').insert({
        duration_ms: totalMs,
        decision_count: syncDecisions.length,
        decisions: syncDecisions,
        final_result: `Synkfrekvens: ${desiredInterval / 60} min (${reasons})`,
        adjustment_made: changed,
      } as any);
    } catch (e) {
      console.error('Dynamic sync frequency error:', e);
    }

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
