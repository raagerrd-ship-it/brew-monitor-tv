import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { createBrewSnapshot } from '../_shared/brew-snapshots.ts';
import { standardSgCorrection, applySgCorrection, processSgCalibration, getLearnedResidual } from '../_shared/sg-temp-correction.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// ── Inlined RAPT auth with DB token cache ──
interface RaptTokenResult { token: string; fromCache: boolean; authDurationMs?: number; }
async function getRaptTokenWithMeta(supabase?: any): Promise<RaptTokenResult> {
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
          return { token: cached.access_token, fromCache: true };
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
  const authStart = Date.now();

  // Try up to 2 attempts (initial + 1 retry on timeout/error)
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${authBaseUrl}/connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
        signal: AbortSignal.timeout(45000),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`RAPT auth error: ${res.status} ${errorText}`);
      }
      const data = await res.json();
      const authDurationMs = Date.now() - authStart;

      // Cache the new token (awaited to ensure it persists before function shuts down)
      if (supabase && data.expires_in) {
        const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
        const { error: cacheErr } = await supabase.from('rapt_token_cache')
          .upsert({ id: '00000000-0000-0000-0000-000000000001', access_token: data.access_token, expires_at: expiresAt }, { onConflict: 'id' });
        if (cacheErr) console.error('Token cache write failed:', cacheErr);
        console.log('🔑 Fresh RAPT token cached (expires in ' + Math.round(data.expires_in / 60) + 'min)');
      }

      return { token: data.access_token, fromCache: false, authDurationMs };
    } catch (e) {
      lastError = e as Error;
      if (attempt === 0) {
        console.log(`🔑 RAPT auth attempt 1 failed (${(e as Error).message}), retrying...`);
      }
    }
  }
  throw lastError!;
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

Deno.serve(async (req) => {
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

    // Read sync_settings + auto_cooling_settings once (reused across phases)
    const [{ data: syncSettingsRow }, { data: autoCoolingRow }] = await Promise.all([
      supabase.from('sync_settings')
        .select('id, last_successful_rapt_sync_at, rapt_sync_interval, brewfather_enabled').single(),
      supabase.from('auto_cooling_settings')
        .select('sg_temp_correction_enabled, cooler_controller_id, enabled, pill_compensation_enabled').limit(1).maybeSingle(),
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
    
    let pillsUpdated = 0;
    let controllersUpdated = 0;
    let raptFailed = false;
    let raptFailedPhase = '';
    let tPhase1Auth = 0, tPhase1Fetch = 0, tPhase1Upsert = 0;
    let tokenFromCache = true;
    let tokenAuthDurationMs: number | undefined;
    let controllerUpdatesForHistory: Record<string, any>[] = [];
    let fetchedPills: any[] = [];

    // Phase 1a: Auth + selected device IDs in parallel
    const tPhase1 = Date.now();
    const tAuth = Date.now();

    try {
      raptFailedPhase = '1a auth';
      const [{ data: selectedPills }, { data: selectedControllers }, tokenResult] = await Promise.all([
        supabase.from('selected_rapt_pills').select('pill_id').eq('is_visible', true),
        supabase.from('selected_rapt_temp_controllers').select('controller_id').eq('is_visible', true),
        passedToken ? Promise.resolve({ token: passedToken, fromCache: true } as RaptTokenResult) : getRaptTokenWithMeta(supabase),
      ]);
      access_token = tokenResult.token;
      tokenFromCache = tokenResult.fromCache;
      tokenAuthDurationMs = tokenResult.authDurationMs;
      selectedPillIds = selectedPills?.map(p => p.pill_id) || [];
      selectedControllerIds = selectedControllers?.map(c => c.controller_id) || [];
      tPhase1Auth = Date.now() - tAuth;
      console.log(`  ⏱️ Phase 1a (auth + device IDs): ${tPhase1Auth}ms`);

      // Phase 1b: Fetch pills + controllers from RAPT API in parallel
      raptFailedPhase = '1b fetch';
      const tFetch = Date.now();
      let fetchedControllers: any[];
      [fetchedPills, fetchedControllers] = await Promise.all([
        selectedPillIds.length > 0 ? fetchRaptPills(access_token) : Promise.resolve([]),
        selectedControllerIds.length > 0 ? fetchRaptControllers(access_token) : Promise.resolve([]),
      ]);
      tPhase1Fetch = Date.now() - tFetch;
      console.log(`  ⏱️ Phase 1b (fetch pills+controllers): ${tPhase1Fetch}ms`);

      // Phase 1c: Upsert to DB
      raptFailedPhase = '1c upsert';
      const tUpsertStart = Date.now();

      // Build pill temperature map AND reverse map: controller_id → pill_id
      // Pills have pairedDeviceId pointing to their controller, so we reverse-map
      const pillTempMap = new Map<string, number>();       // pill_id → temp
      const controllerToPillId = new Map<string, string>(); // controller_id → pill_id
      for (const pill of fetchedPills) {
        const temp = pill.temperature ?? pill.telemetry?.[0]?.temperature;
        if (temp != null && temp !== 0) {
          pillTempMap.set(pill.id, temp);
        }
        if (pill.pairedDeviceId) {
          controllerToPillId.set(pill.pairedDeviceId, pill.id);
        }
      }

      // Upsert Pills
      if (selectedPillIds.length > 0) {
        const selectedPillsData = fetchedPills.filter((pill: any) => selectedPillIds.includes(pill.id));
        if (selectedPillsData.length > 0) {
          const pillUpserts = selectedPillsData.map((pill: any) => ({
            pill_id: pill.id,
            name: pill.name || pill.id,
            battery_level: Math.round(pill.battery || 0),
            gravity: pill.gravity ?? pill.telemetry?.[0]?.gravity ?? null,
            temperature: pill.temperature ?? pill.telemetry?.[0]?.temperature ?? null,
            last_update: pill.lastActivityTime || pill.telemetry?.[0]?.createdOn,
            paired_device_id: pill.pairedDeviceId || null,
            updated_at: new Date().toISOString()
          }));
          const { error: pillUpsertErr } = await supabase.from('rapt_pills')
            .upsert(pillUpserts, { onConflict: 'pill_id', ignoreDuplicates: false });
          if (pillUpsertErr) console.error('Pill upsert error:', pillUpsertErr);
          else pillsUpdated = selectedPillsData.length;
        }
      }

      // Upsert Controllers with enriched pill_temp
      if (selectedControllerIds.length > 0) {
        const selectedControllersData = fetchedControllers.filter((c: any) => selectedControllerIds.includes(c.id));

        const [{ data: activeSessions }, { data: existingControllers }] = await Promise.all([
          supabase.from('fermentation_sessions').select('controller_id').in('status', ['running', 'paused']),
          supabase.from('rapt_temp_controllers').select('controller_id, linked_pill_id, target_temp')
            .in('controller_id', selectedControllersData.map((c: any) => c.id)),
        ]);
        const controllersWithActiveSessions = new Set(activeSessions?.map(s => s.controller_id) || []);
        const coolerControllerId = autoCoolingRow?.enabled ? autoCoolingRow?.cooler_controller_id : null;
        const isPillCompEnabled = autoCoolingRow?.enabled && autoCoolingRow?.pill_compensation_enabled;
        const existingMap = new Map((existingControllers || []).map(c => [c.controller_id, c]));
        const manualChangeDetections: { controllerId: string; controllerName: string; hardwareTarget: number; dbTarget: number; source: string }[] = [];
        const controllerUpdates: Record<string, any>[] = [];

        for (const controller of selectedControllersData) {
          const currentTemp = controller.temperature || controller.telemetry?.[0]?.temperature;
          const targetTemp = controller.targetTemperature;
          const lastUpdate = controller.lastActivityTime || controller.telemetry?.[0]?.createdOn;

          // Determine linked pill: API controller field, reverse pill→controller map, then DB fallback
          const linkedPillId = controller.controlDeviceId || controller.linkedDevice || controller.linkedDeviceId
            || controllerToPillId.get(controller.id)
            || existingMap.get(controller.id)?.linked_pill_id || null;
          const pillTemp = linkedPillId ? (pillTempMap.get(linkedPillId) ?? null) : null;

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
        // Save for Phase 2c tempHistoryTask (avoid extra DB read)
        controllerUpdatesForHistory = controllerUpdates;

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

      // Use Phase 1 in-memory data instead of redundant DB queries
      const pillMap = new Map<string, any>();
      for (const pill of fetchedPills) {
        pillMap.set(pill.id, pill);
      }
      const dbCtrlMap = new Map<string, any>();
      for (const ctrl of controllerUpdatesForHistory) {
        dbCtrlMap.set(ctrl.controller_id, ctrl);
      }
      // Fallback: if Phase 1 failed (raptFailed), read from DB
      if (pillMap.size === 0 && controllerUpdatesForHistory.length === 0) {
        const [{ data: dbPills }, { data: dbControllers }] = await Promise.all([
          supabase.from('rapt_pills').select('pill_id, name, paired_device_id, gravity, temperature, battery_level, last_update'),
          supabase.from('rapt_temp_controllers').select('controller_id, linked_pill_id, pill_temp, current_temp, target_temp, profile_target_temp'),
        ]);
        for (const p of (dbPills || [])) pillMap.set(p.pill_id, { id: p.pill_id, name: p.name, pairedDeviceId: p.paired_device_id, gravity: p.gravity, temperature: p.temperature, battery: p.battery_level, lastActivityTime: p.last_update });
        for (const c of (dbControllers || [])) dbCtrlMap.set(c.controller_id, c);
      }

      // Separate brews into initial-sync (need telemetry API) vs quick-append
      const initialSyncBrews: { brew: any; pillId: string }[] = [];
      const quickAppendBrews: { brew: any; pillId: string }[] = [];

      for (const brew of customBrews) {
        let pillId = brew.linked_pill_id;
        
        if (!pillId && brew.linked_controller_id) {
          const controller = dbCtrlMap.get(brew.linked_controller_id);
          if (controller?.linked_pill_id) pillId = controller.linked_pill_id;
        }

        if (!pillId) {
          // Try matching via paired_device_id + temp
          for (const [pId, pill] of pillMap) {
            const pairedId = pill.pairedDeviceId || pill.paired_device_id;
            if (!pairedId) continue;
            const controller = dbCtrlMap.get(pairedId);
            if (controller?.pill_temp != null && Math.abs(controller.pill_temp - brew.current_temp) <= 3) {
              pillId = pId;
              console.log(`Auto-matched pill ${pill.name} to brew ${brew.name} via paired_device_id + temp matching`);
              break;
            }
          }
        }
        
        if (!pillId) {
          console.log(`No pill_id available for brew ${brew.name}, skipping`);
          continue;
        }

        const existingSgData: SgDataPoint[] = Array.isArray(brew.sg_data) ? brew.sg_data : [];
        if (existingSgData.length === 0) {
          initialSyncBrews.push({ brew, pillId });
        } else {
          quickAppendBrews.push({ brew, pillId });
        }
      }

      // ── Quick-append: use Phase 1 pill data (no API call) ──
      for (const { brew, pillId } of quickAppendBrews) {
        try {
          const pill = pillMap.get(pillId);
          if (!pill) {
            console.log(`Pill ${pillId} not found in memory for brew ${brew.name}, skipping quick-append`);
            continue;
          }

          const rawGravity = pill.gravity ?? pill.telemetry?.[0]?.gravity;
          const pillTemp = pill.temperature ?? pill.telemetry?.[0]?.temperature;
          const pillBattery = Math.round(pill.battery || pill.battery_level || 0);
          const pillLastUpdate = pill.lastActivityTime || pill.last_update || pill.telemetry?.[0]?.createdOn;

          if (rawGravity == null || pillTemp == null || !pillLastUpdate) {
            console.log(`Incomplete pill data for ${brew.name} (gravity=${rawGravity}, temp=${pillTemp}), skipping`);
            continue;
          }

          // Convert raw gravity (e.g. 1045) to SG (1.045)
          let sgValue = rawGravity > 100 ? rawGravity / 1000 : rawGravity;

          // Apply SG correction if enabled
          if (sgTempCorrectionEnabled) {
            try {
              const { residualPerDegree, confident } = await getLearnedResidual(supabase, pillId);
              if (confident) {
                sgValue = applySgCorrection(sgValue, pillTemp, residualPerDegree);
              }
            } catch (_e) { /* no correction */ }
          }

          // Filter invalid values
          if (sgValue < 0.990 || sgValue > 1.200) {
            console.log(`SG ${sgValue} out of range for ${brew.name}, skipping`);
            continue;
          }

          const fermentationStartDate = brew.fermentation_start ? new Date(brew.fermentation_start) : null;
          const newPointDate = new Date(pillLastUpdate).toISOString();
          if (fermentationStartDate && new Date(newPointDate) < fermentationStartDate) continue;

          const existingSgData: SgDataPoint[] = Array.isArray(brew.sg_data) ? brew.sg_data : [];
          const existingDates = new Set(existingSgData.map(d => d.date));
          
          // Dedup: skip if this timestamp already exists
          if (existingDates.has(newPointDate)) {
            // Still update controller probe temp if available
            if (brew.linked_controller_id) {
              const ctrl = dbCtrlMap.get(brew.linked_controller_id);
              if (ctrl?.current_temp != null) {
                await supabase.from('brew_readings')
                  .update({ current_temp: ctrl.current_temp, updated_at: new Date().toISOString() })
                  .eq('id', brew.id);
              }
            }
            continue;
          }

          const newPoint: SgDataPoint = { date: newPointDate, value: sgValue, temp: pillTemp };
          const mergedSgData = [...existingSgData, newPoint]
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

          const latestData = mergedSgData[mergedSgData.length - 1];
          const og = brew.original_gravity;
          const currentSg = latestData.value;
          const attenuation = og > 1 ? Math.round(((og - currentSg) / (og - 1)) * 100) : 0;
          const abv = og > 1 ? Number(((og - currentSg) * 131.25).toFixed(1)) : 0;

          const { error: updateError } = await supabase
            .from('brew_readings')
            .update({
              sg_data: mergedSgData, current_sg: currentSg, current_temp: latestData.temp,
              attenuation: Math.max(0, Math.min(100, attenuation)),
              abv: Math.max(0, abv), battery: pillBattery,
              last_update: latestData.date, updated_at: new Date().toISOString()
            })
            .eq('id', brew.id);

          if (updateError) { console.error(`Failed to update brew ${brew.name}:`, updateError); continue; }
          console.log(`Quick-appended 1 point to ${brew.name} (SG=${sgValue.toFixed(4)}, ${pillTemp.toFixed(1)}°C)`);
          customBrewsUpdated++;

          if (sgTempCorrectionEnabled) {
            try { await processSgCalibration(supabase, pillId, mergedSgData); } catch (calErr) { console.error(`SG calibration error for pill ${pillId}:`, calErr); }
          }
        } catch (brewError) {
          console.error(`Error quick-appending brew ${brew.name}:`, brewError);
        }
      }

      // ── Initial sync: fetch full telemetry history (parallel) ──
      if (initialSyncBrews.length > 0 && access_token) {
        console.log(`Initial sync for ${initialSyncBrews.length} brews (fetching telemetry)...`);
        await Promise.all(initialSyncBrews.map(async ({ brew, pillId }) => {
          try {
            const endDate = new Date();
            let startDate: Date;
            if (brew.fermentation_start) {
              startDate = new Date(brew.fermentation_start);
            } else {
              const brewCreatedDate = new Date(brew.created_at);
              const thirtyDaysAgo = new Date();
              thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
              startDate = brewCreatedDate < thirtyDaysAgo ? thirtyDaysAgo : brewCreatedDate;
            }

            let telemetryData: TelemetryRecord[];
            try {
              telemetryData = await fetchPillTelemetryCorrected(access_token!, pillId, startDate.toISOString(), endDate.toISOString(), supabase, sgTempCorrectionEnabled);
            } catch (telemetryError) {
              console.error(`Failed to fetch telemetry for brew ${brew.name}:`, telemetryError);
              return;
            }

            if (!telemetryData || telemetryData.length === 0) {
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
              return;
            }

            const fermentationStartDate = brew.fermentation_start ? new Date(brew.fermentation_start) : null;
            const newSgData: SgDataPoint[] = telemetryData
              .map((t: TelemetryRecord) => ({ date: new Date(t.createdOn).toISOString(), value: t.gravity / 1000, temp: t.temperature }))
              .filter((d: SgDataPoint) => {
                if (d.value < 0.990 || d.value > 1.200) return false;
                if (fermentationStartDate && new Date(d.date) < fermentationStartDate) return false;
                return true;
              });

            if (newSgData.length === 0) return;

            const mergedSgData = newSgData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
            const firstData = mergedSgData[0];
            const latestData = mergedSgData[mergedSgData.length - 1];
            const latestTelemetry = telemetryData[telemetryData.length - 1];

            let og = brew.original_gravity;
            if (firstData.value >= 1.030 && firstData.value <= 1.150) {
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

            if (updateError) { console.error(`Failed to update brew ${brew.name}:`, updateError); return; }
            console.log(`Initial sync: Updated custom brew ${brew.name} with ${newSgData.length} data points`);
            customBrewsUpdated++;

            if (sgTempCorrectionEnabled) {
              try { await processSgCalibration(supabase, pillId, mergedSgData); } catch (calErr) { console.error(`SG calibration error for pill ${pillId}:`, calErr); }
            }
          } catch (brewError) {
            console.error(`Error processing brew ${brew.name}:`, brewError);
          }
        }));
      } else if (initialSyncBrews.length > 0) {
        console.log(`No RAPT token available for ${initialSyncBrews.length} initial sync brews, skipping`);
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

    // ──────────────────────────────────────────────────────────
    // PHASE 2b: Run automation AFTER all data is synced (SSOT principle)
    // Automation runs in dryRun mode — returns pendingUpdates
    // instead of flushing to RAPT API. Flush happens in Phase 3.
    // ──────────────────────────────────────────────────────────
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

    let automationResult: any = null;
    const tPhase2b = Date.now();

    if (systemIsIdle) {
      console.log('⏱️ Phase 2b (automation): SKIPPED — system idle');
    } else {
      console.log('All data synced — running automation (dryRun)...');

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
          body: { rapt_access_token: access_token, brew_sg_data, dryRun: true }
        });
        if (autoResponse.error) console.error('Automation error:', autoResponse.error);
        else automationResult = autoResponse.data;
      } catch (autoErr) {
        console.error('Automation error:', autoErr);
      }
      console.log(`⏱️ Phase 2b (automation dryRun): ${Date.now() - tPhase2b}ms`);
    }

    // ──────────────────────────────────────────────────────────
    // PHASE 3: EXECUTE — Flush RAPT updates + history + snapshots
    // Single outbound RAPT interaction per cycle.
    // ──────────────────────────────────────────────────────────
    console.log('Phase 3: Execute (RAPT flush + history + snapshots + logging)...');
    const tPhase3 = Date.now();

    // 3a: Flush pending RAPT updates from automation dryRun
    const pendingUpdates: { controllerId: string; targetTemp: number; oldTarget?: number }[] = automationResult?.pendingUpdates ?? [];
    const hwOnlyIds: string[] = automationResult?.hwOnlyIds ?? [];
    const retriesToProcess: { id: string; controller_id: string; target_temp: number; reason: string; attempts: number }[] = automationResult?.retriesToProcess ?? [];
    const pendingKickControllerId: string | null = automationResult?.pendingKickControllerId ?? null;
    const automationDecisionLog: any[] = automationResult?.automationDecisions ?? [];

    let flushResults = new Map<string, boolean>();
    const tPhase3a = Date.now();

    if (pendingUpdates.length > 0 && access_token) {
      const { RaptUpdateBatch } = await import('../_shared/temp-utils.ts');
      const batch = new RaptUpdateBatch(access_token);

      for (const pu of pendingUpdates) {
        if (hwOnlyIds.includes(pu.controllerId)) {
          batch.addHardwareOnly(pu.controllerId, pu.targetTemp, pu.oldTarget);
        } else {
          batch.add(pu.controllerId, pu.targetTemp, pu.oldTarget);
        }
      }

      console.log(`🔄 Phase 3a: Flushing ${batch.size} RAPT update(s)...`);
      flushResults = await batch.flush();
      const failed = [...flushResults.entries()].filter(([, ok]) => !ok);

      if (failed.length > 0) {
        console.error(`Phase 3a: ${failed.length} update(s) failed`);

        // Remove adjustment log entries for failed controllers
        const cycleStart = new Date(syncStartTime).toISOString();
        for (const [controllerId] of failed) {
          await supabase.from('auto_cooling_adjustments')
            .delete()
            .eq('cooler_controller_id', controllerId)
            .gte('created_at', cycleStart);
        }

        // Save failed updates for retry next cycle
        for (const [controllerId] of failed) {
          const pu = pendingUpdates.find(p => p.controllerId === controllerId);
          if (!pu) continue;
          const existingRetry = retriesToProcess.find(r => r.controller_id === controllerId);
          const attempts = (existingRetry?.attempts ?? 0) + 1;

          if (attempts >= 5) {
            if (existingRetry) {
              await supabase.from('pending_rapt_retries').delete().eq('id', existingRetry.id);
            }
          } else if (existingRetry) {
            await supabase.from('pending_rapt_retries')
              .update({ target_temp: pu.targetTemp, attempts })
              .eq('id', existingRetry.id);
          } else {
            await supabase.from('pending_rapt_retries').insert({
              controller_id: controllerId,
              target_temp: pu.targetTemp,
              reason: `Flush failed in Phase 3`,
              attempts: 1,
            } as any);
          }
        }
      } else {
        console.log(`✅ Phase 3a: All ${flushResults.size} update(s) sent successfully`);
      }

      // Clean up retries that succeeded
      const succeeded = [...flushResults.entries()].filter(([, ok]) => ok);
      for (const [controllerId] of succeeded) {
        const existingRetry = retriesToProcess.find(r => r.controller_id === controllerId);
        if (existingRetry) {
          await supabase.from('pending_rapt_retries').delete().eq('id', existingRetry.id);
        }
      }

      // Persist successful target_temp changes to DB (skip hardware-only)
      if (succeeded.length > 0) {
        const dbUpdates = succeeded
          .filter(([controllerId]) => !hwOnlyIds.includes(controllerId))
          .map(([controllerId]) => {
            const pu = pendingUpdates.find(p => p.controllerId === controllerId);
            return supabase
              .from('rapt_temp_controllers')
              .update({ target_temp: pu?.targetTemp, updated_at: new Date().toISOString() })
              .eq('controller_id', controllerId);
          });
        if (dbUpdates.length > 0) {
          await Promise.allSettled(dbUpdates);
        }
      }

      // Set hysteresis_kick_active flag after confirmed flush
      if (pendingKickControllerId) {
        const kickSucceeded = flushResults.get(pendingKickControllerId) === true;
        if (kickSucceeded) {
          await supabase.from('rapt_temp_controllers')
            .update({ hysteresis_kick_active: true })
            .eq('controller_id', pendingKickControllerId);
        }
      }

      // Log RAPT_SEND entries for succeeded updates (into the automation decision log)
      // Build controller name lookup from Phase 1c data
      const ctrlNameMap = new Map(controllerUpdatesForHistory.map(c => [c.controller_id, c.name as string]));
      for (const [controllerId] of succeeded) {
        const pu = pendingUpdates.find(p => p.controllerId === controllerId);
        if (!pu) continue;
        const oldTarget = pu.oldTarget;
        const newTarget = pu.targetTemp;
        // Skip logging when rounded values are identical
        if (oldTarget != null && Math.abs(Math.round(oldTarget * 10) - Math.round(newTarget * 10)) < 1) continue;
        const isPwmSend = hwOnlyIds.includes(controllerId) && newTarget === 0;
        const controllerName = ctrlNameMap.get(controllerId) || controllerId;
        automationDecisionLog.push({
          step: 'RAPT_SEND', result: 'action',
          message: `${controllerName}: ${oldTarget ?? '?'}°C → ${newTarget}°C`,
          details: { controller_id: controllerId, old_target: oldTarget, new_target: newTarget, ...(isPwmSend && { is_pwm: true }) },
        });
      }
    } else if (pendingUpdates.length > 0 && !access_token) {
      console.log('⚠️ Phase 3a: RAPT updates pending but no access token — skipping flush');
    }
    const tPhase3aEnd = Date.now();

    // 3b: Log temp history + outage detection + snapshots in PARALLEL
    console.log('Phase 3b: History + outage + snapshots (parallel)...');

    const tempHistoryTask = async () => {
      // Use in-memory controllerUpdatesForHistory from Phase 1c — no extra DB query needed.
      if (controllerUpdatesForHistory.length === 0) return;

      // Batch-read only the columns automation may have changed (target_temp, profile_target_temp)
      const { data: postAutoValues } = await supabase
        .from('rapt_temp_controllers')
        .select('controller_id, target_temp, profile_target_temp')
        .in('controller_id', controllerUpdatesForHistory.map(c => c.controller_id));
      const postAutoMap = new Map((postAutoValues || []).map((c: any) => [c.controller_id, c]));

      // Insert temp history + delta history in parallel
      const historyRecords = controllerUpdatesForHistory.map(c => {
        const post = postAutoMap.get(c.controller_id);
        return {
          controller_id: c.controller_id,
          current_temp: c.current_temp ?? c.pill_temp,
          target_temp: post?.target_temp ?? c.target_temp,
          cooling_enabled: c.cooling_enabled || false,
          profile_target_temp: post?.profile_target_temp ?? c.target_temp,
          cooling_run_time: c.cooling_run_time ?? null,
        };
      });

      const deltaRecords = controllerUpdatesForHistory
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
      console.log(`Recorded temp history for ${controllerUpdatesForHistory.length} controllers`);
    };

    const outageTask = async () => {
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
      if (syncSettingsRow?.id && !raptFailed) {
        await supabase.from('sync_settings').update({ last_successful_rapt_sync_at: now.toISOString() }).eq('id', syncSettingsRow.id);
      }
    };

    const snapshotTask = async () => {
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

    const [histResult, outageResult, snapResult] = await Promise.allSettled([tempHistoryTask(), outageTask(), snapshotTask()]);
    if (histResult.status === 'rejected') console.error('Temp history error:', histResult.reason);
    if (outageResult.status === 'rejected') console.error('Outage log error:', outageResult.reason);
    if (snapResult.status === 'rejected') console.error('Snapshot error:', snapResult.reason);

    // 3c: Dynamic sync frequency + consolidated decision log
    try {
      const currentInterval = syncSettingsRow?.rapt_sync_interval ?? 300;
      const [{ data: activeSessionsCheck }, { data: autoCoolingCheck }] = await Promise.all([
        supabase.from('fermentation_sessions').select('id').in('status', ['running', 'paused']).limit(1),
        supabase.from('auto_cooling_settings').select('enabled, cooler_controller_id').limit(1).maybeSingle(),
      ]);
      let coolerController: { target_temp: number | null; max_target_temp: number | null } | null = null;
      if (autoCoolingCheck?.cooler_controller_id) {
        const { data: ctrl } = await supabase.from('rapt_temp_controllers')
          .select('target_temp, max_target_temp')
          .eq('controller_id', autoCoolingCheck.cooler_controller_id).maybeSingle();
        coolerController = ctrl;
      }
      const hasActiveSessions = activeSessionsCheck && activeSessionsCheck.length > 0;
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
          profile_target: isGlycol
            ? (cu.target_temp != null ? Math.round(cu.target_temp * 10) / 10 : null)
            : (cu.profile_target_temp != null ? Math.round(cu.profile_target_temp * 10) / 10 : null),
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
      if (!tokenFromCache) {
        syncDecisions.push({
          step: 'TOKEN_REFRESH', result: 'action', message: `Ny RAPT-token hämtad (${tokenAuthDurationMs ? Math.round(tokenAuthDurationMs / 1000) + 's' : '?'})`,
          details: { auth_duration_ms: tokenAuthDurationMs ?? null },
        });
      }
      syncDecisions.push({
        step: 'PHASE_TIMINGS', result: 'info', message: 'Fas-tider',
        details: {
          '1_fetch_ms': Math.round(tPhase2a - tPhase1),
          '1a_auth_ms': tPhase1Auth,
          '1b_fetch_ms': tPhase1Fetch,
          '1c_upsert_ms': tPhase1Upsert,
          ...(raptFailed ? { '1_failed_in': raptFailedPhase } : {}),
          '2_process_ms': Math.round(tPhase3 - tPhase2a),
          '2a_brew_ms': Math.round(tPhase2b - tPhase2a),
          '2b_auto_ms': Math.round(tPhase3 - tPhase2b),
          '3_execute_ms': Math.round(totalMs - (tPhase3 - syncStartTime)),
          '3a_flush_ms': Math.round(tPhase3aEnd - tPhase3a),
          total_ms: totalMs,
        }
      });
      // Merge automation decisions with sync decisions
      // Filter out SYNC_DATA and BREW_SG_STATUS from automation — sync generates more complete versions
      const filteredAutomationDecisions: any[] = (automationResult?.automationDecisions ?? [])
        .filter((d: any) => d.step !== 'SYNC_DATA' && d.step !== 'BREW_SG_STATUS' && d.step !== 'RAPT_SEND');
      // Add RAPT_SEND decisions generated during Phase 3a flush
      const raptSendDecisions = automationDecisionLog.filter((d: any) => d.step === 'RAPT_SEND');
      const allDecisions = [...filteredAutomationDecisions, ...raptSendDecisions, ...syncDecisions];
      const automationMadeAdjustment = automationResult?.automationAdjustmentMade === true;
      const automationFinal = automationResult?.automationFinalResult;
      const combinedFinalResult = automationFinal
        ? `${automationFinal} | Synkfrekvens: ${desiredInterval / 60} min (${reasons})`
        : `Synkfrekvens: ${desiredInterval / 60} min (${reasons})`;
      await supabase.from('auto_cooling_decision_logs').insert({
        duration_ms: totalMs,
        decision_count: allDecisions.length,
        decisions: allDecisions,
        final_result: combinedFinalResult,
        adjustment_made: changed || automationMadeAdjustment,
      } as any);
    } catch (e) {
      console.error('Phase 3c (sync freq + logging) error:', e);
    }

    console.log(`⏱️ Phase 3 (execute): ${Date.now() - tPhase3}ms`);

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
