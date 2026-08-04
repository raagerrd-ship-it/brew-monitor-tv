import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { createBrewSnapshot } from '../_shared/brew-snapshots.ts';
import { fetchSgDataFromSnapshots } from '../_shared/types.ts';
import { applySgCorrection, processSgCalibration, getLearnedResidual } from '../_shared/sg-temp-correction.ts';
import { processAllSessions } from '../_shared/process-profiles-logic.ts';
import { computeAllMetrics } from '../_shared/fermentation-metrics-logic.ts';
import { computeSystemHealth } from '../_shared/system-health-logic.ts';
import { isSensorDataStale } from '../_shared/temp-utils.ts';
import { insertNotification } from '../_shared/notifications.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// SG temp-correction is now always active — it's pure math applied to BLE pill
// readings already in the DB, no RAPT dependency, no user toggle left to read.
const SG_TEMP_CORRECTION_ENABLED = true;

// ── Custom brew sync: SG correction + calibration on BLE pill data already in DB ──
// Temperature control (Pi + local PID) no longer touches this — this only keeps
// brew_readings/brew_data_snapshots fresh for brews tracked via a RAPT/BLE pill.
async function syncCustomBrews(supabase: any): Promise<number> {
  const { data: customBrews } = await supabase
    .from('brew_readings')
    .select('id, batch_id, name, original_gravity, linked_controller_id, linked_pill_id, status, fermentation_start')
    .like('batch_id', 'custom\\_%')
    .in('status', ['Jäsning', 'Fermenting']);

  if (!customBrews || customBrews.length === 0) return 0;
  console.log(`Found ${customBrews.length} custom brews in fermentation`);

  let updated = 0;

  for (const brew of customBrews) {
    try {
      let pillId = brew.linked_pill_id;
      let linkedController: any = null;

      if (brew.linked_controller_id) {
        const { data: ctrl } = await supabase
          .from('rapt_temp_controllers')
          .select('controller_id, linked_pill_id, current_temp, actual_temp, profile_target_temp')
          .eq('controller_id', brew.linked_controller_id)
          .maybeSingle();
        linkedController = ctrl;
        if (!pillId && ctrl?.linked_pill_id) pillId = ctrl.linked_pill_id;
      }

      if (!pillId) {
        console.log(`No pill_id available for brew ${brew.name}, skipping`);
        continue;
      }

      const { data: pill } = await supabase
        .from('rapt_pills')
        .select('pill_id, gravity, temperature, battery_level, last_update')
        .eq('pill_id', pillId)
        .maybeSingle();

      if (!pill || pill.gravity == null || pill.temperature == null || !pill.last_update) {
        console.log(`Incomplete pill data for ${brew.name}, skipping`);
        continue;
      }

      const fermentationStartDate = brew.fermentation_start ? new Date(brew.fermentation_start) : null;
      const recordedAt = new Date(pill.last_update).toISOString();
      if (fermentationStartDate && new Date(recordedAt) < fermentationStartDate) continue;

      let sgValue = pill.gravity > 100 ? pill.gravity / 1000 : pill.gravity;

      if (SG_TEMP_CORRECTION_ENABLED) {
        try {
          const { residualPerDegree, confident } = await getLearnedResidual(supabase, pillId);
          if (confident) sgValue = applySgCorrection(sgValue, pill.temperature, residualPerDegree);
        } catch (_e) { /* no correction yet */ }
      }

      if (sgValue < 0.990 || sgValue > 1.200) {
        console.log(`SG ${sgValue} out of range for ${brew.name}, skipping`);
        continue;
      }

      const og = brew.original_gravity;
      const attenuation = og > 1 ? Math.round(((og - sgValue) / (og - 1)) * 100) : 0;
      const abv = og > 1 ? Number(((og - sgValue) * 131.25).toFixed(1)) : 0;

      // SSOT: prefer controller actual_temp over pill temp when linked
      const ssotTemp = linkedController?.actual_temp ?? pill.temperature;

      await createBrewSnapshot(supabase, brew.id, {
        recorded_at: recordedAt,
        sg: sgValue,
        pill_temp: pill.temperature,
        controller_temp: linkedController?.current_temp ?? null,
        profile_target_temp: linkedController?.profile_target_temp ?? null,
        actual_temp: ssotTemp,
        controller_id: brew.linked_controller_id ?? null,
      });

      const { error: updateError } = await supabase
        .from('brew_readings')
        .update({
          current_sg: sgValue, current_temp: ssotTemp,
          attenuation: Math.max(0, Math.min(100, attenuation)),
          abv: Math.max(0, abv), battery: Math.round(pill.battery_level || 0),
          last_update: recordedAt, updated_at: new Date().toISOString(),
        })
        .eq('id', brew.id);

      if (updateError) { console.error(`Failed to update brew ${brew.name}:`, updateError); continue; }
      console.log(`Synced ${brew.name} (SG=${sgValue.toFixed(4)}, ${pill.temperature.toFixed(1)}°C)`);
      updated++;

      if (SG_TEMP_CORRECTION_ENABLED) {
        try {
          const snapshots = await fetchSgDataFromSnapshots(supabase, brew.id);
          await processSgCalibration(supabase, pillId, snapshots);
        } catch (calErr) { console.error(`SG calibration error for pill ${pillId}:`, calErr); }
      }
    } catch (brewError) {
      console.error(`Error syncing brew ${brew.name}:`, brewError);
    }
  }

  return updated;
}

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
    const { data: syncSettingsRow } = await supabase
      .from('sync_settings')
      .select('id, last_rapt_quick_sync_at, rapt_sync_interval')
      .single();

    if (syncSettingsRow?.last_rapt_quick_sync_at) {
      const secsSinceLast = (Date.now() - new Date(syncSettingsRow.last_rapt_quick_sync_at).getTime()) / 1000;
      if (secsSinceLast < 30) {
        console.log(`⏭️ Skipping sync — last ran ${secsSinceLast.toFixed(0)}s ago`);
        return new Response(JSON.stringify({ skipped: 'concurrent', seconds_since_last: Math.round(secsSinceLast) }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    console.log('Starting quick sync (custom brews + fermentation profiles/metrics/health)...');

    // Stamp timestamp immediately so the concurrency guard sees this run
    const nowIso = new Date().toISOString();
    if (syncSettingsRow?.id) {
      await supabase.from('sync_settings').update({ last_rapt_quick_sync_at: nowIso }).eq('id', syncSettingsRow.id);
    }

    // ──────────────────────────────────────────────────────
    // PHASE 2a: Sync custom brews (SG correction/calibration on BLE data)
    // ──────────────────────────────────────────────────────
    const tPhase2a = Date.now();
    let customBrewsUpdated = 0;
    try {
      customBrewsUpdated = await syncCustomBrews(supabase);
    } catch (err) {
      console.error('Custom brew sync error:', err);
    }
    console.log(`⏱️ Phase 2a (custom brews): ${Date.now() - tPhase2a}ms`);

    // ──────────────────────────────────────────────────────
    // PHASE 2b: Fermentation profiles + metrics + system health
    // Temperature control itself is fully owned by the Pi's local PID now —
    // this only keeps profile/metrics/health bookkeeping up to date.
    // ──────────────────────────────────────────────────────
    const tPhase2b = Date.now();

    const [{ data: controllers }, { data: activeSessCheck }] = await Promise.all([
      supabase
        .from('rapt_temp_controllers')
        .select('controller_id, name, current_temp, actual_temp, pill_temp, target_temp, profile_target_temp, cooling_enabled, heating_enabled, is_glycol_cooler, last_update, linked_pill_id'),
      supabase.from('fermentation_sessions').select('*').eq('status', 'running').limit(100),
    ]);
    const controllerList = controllers ?? [];
    const hasActiveSessions = activeSessCheck && activeSessCheck.length > 0;

    let profilesResult: any = { __skipped: true };
    let metricsResult: any = null;
    let healthResult: any = null;

    if (hasActiveSessions) {
      const { data: allFermentingBrews } = await supabase
        .from('brew_readings')
        .select('id, name, original_gravity, final_gravity, current_sg, current_temp, battery, status, last_update, linked_controller_id, fermentation_start, attenuation, style')
        .in('status', ['Jäsning', 'Fermenting']);

      const fermentingBrewIds = (allFermentingBrews ?? []).map((b: any) => b.id);
      const { data: sharedBrewMetrics } = fermentingBrewIds.length > 0
        ? await supabase.from('brew_fermentation_metrics')
            .select('brew_id, fermentation_phase, activity_score, sg_rate_per_hour, eta_to_fg_hours, ready_to_crash, peak_delta, peak_sg_rate_per_hour')
            .in('brew_id', fermentingBrewIds)
        : { data: [] };

      const { data: recentNotifs } = await supabase
        .from('pending_notifications')
        .select('type, created_at')
        .in('type', ['automation_failure', 'controller_conflict', 'step_timeout', 'sensor_offline', 'unknown_step_type'])
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .is('read_at', null);

      [profilesResult, metricsResult, healthResult] = await Promise.all([
        processAllSessions(supabase, {
          sessions: activeSessCheck!,
          controllers: controllerList,
          brewMetrics: sharedBrewMetrics ?? [],
          brewReadings: allFermentingBrews ?? [],
        }).catch((err: any) => { console.error(`profiles error: ${err}`); return { __error: true, __step: 'profiles' }; }),
        computeAllMetrics(supabase, {
          brews: allFermentingBrews ?? [],
          sessions: activeSessCheck ?? [],
          existingMetrics: sharedBrewMetrics ?? [],
        }).catch((err: any) => { console.error(`metrics error: ${err}`); return { __error: true, __step: 'metrics' }; }),
        Promise.resolve(computeSystemHealth(controllerList, activeSessCheck ?? [], recentNotifs ?? []))
          .catch((err: any) => { console.error(`health error: ${err}`); return { __error: true, __step: 'health' }; }),
      ]);

      // Health critical notification
      if (healthResult && !healthResult.__error && healthResult.overall_status === 'critical') {
        const issuesSummary = (healthResult.issues as string[])?.slice(0, 3).join('; ') ?? 'Unknown issues';
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { data: recentHealthNotifs } = await supabase
          .from('pending_notifications').select('id')
          .eq('type', 'system_health_critical').gte('created_at', oneHourAgo).limit(1);
        if (!recentHealthNotifs || recentHealthNotifs.length === 0) {
          await supabase.from('pending_notifications').insert({
            type: 'system_health_critical', title: 'Systemhälsa: Kritisk', body: issuesSummary,
          });
        }
      }

      console.log(`⏱️ Phase 2b (profiles/metrics/health): ${Date.now() - tPhase2b}ms`);
    } else {
      console.log('⏱️ Phase 2b (profiles/metrics/health): SKIPPED — no active sessions');
    }

    // ──────────────────────────────────────────────────────
    // PHASE 3: History + snapshots + outage tracking
    // All temperature control is local to the Pi now — this phase only
    // records history / snapshots by reading rapt_temp_controllers /
    // pi_live_state, no outbound RAPT calls.
    // ──────────────────────────────────────────────────────
    console.log('Phase 3: History + snapshots + outage tracking...');
    const tPhase3 = Date.now();

    const tempHistoryTask = async () => {
      if (controllerList.length === 0) return;

      // ── Throttle: only record history every ~15 minutes ──
      const controllerIds = controllerList.map((c: any) => c.controller_id);
      const { data: lastRecords } = await supabase
        .from('temp_controller_history')
        .select('controller_id, recorded_at')
        .in('controller_id', controllerIds)
        .order('recorded_at', { ascending: false })
        .limit(controllerIds.length);

      const lastRecordedMap = new Map<string, number>();
      for (const r of lastRecords ?? []) {
        if (!lastRecordedMap.has(r.controller_id)) {
          lastRecordedMap.set(r.controller_id, new Date(r.recorded_at).getTime());
        }
      }

      const HISTORY_INTERVAL_MS = 15 * 60 * 1000;
      const now = Date.now();
      const controllersToRecord = controllerList.filter((c: any) => {
        const lastAt = lastRecordedMap.get(c.controller_id);
        return !lastAt || (now - lastAt) >= HISTORY_INTERVAL_MS;
      });

      if (controllersToRecord.length === 0) {
        console.log('Temp history throttled — all controllers recorded <15min ago');
        return;
      }

      // Pull live duty/mode from pi_live_state (Pi writes this)
      const recordIds = controllersToRecord.map((c: any) => c.controller_id);
      const { data: liveRows } = await supabase
        .from('pi_live_state')
        .select('controller_id, duty_pct, mode')
        .in('controller_id', recordIds);
      const liveMap = new Map((liveRows || []).map((l: any) => [l.controller_id, l]));

      const historyRecords = controllersToRecord.map((c: any) => {
        const live = liveMap.get(c.controller_id);
        return {
          controller_id: c.controller_id,
          current_temp: c.actual_temp ?? c.current_temp ?? c.pill_temp,
          target_temp: c.target_temp,
          cooling_enabled: c.cooling_enabled || false,
          profile_target_temp: c.profile_target_temp ?? c.target_temp,
          duty_pct: live?.duty_pct ?? null,
          actual_temp: c.actual_temp ?? null,
          pid_mode: live?.mode ?? null,
        };
      });

      const deltaRecords = controllersToRecord
        .filter((c: any) => c.pill_temp !== null && c.current_temp !== null)
        .map((c: any) => ({
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
      console.log(`Recorded temp history for ${controllersToRecord.length}/${controllerList.length} controllers (15min throttle)`);
    };

    const outageTask = async () => {
      // Per-controller outage tracking — controllers going stale/offline
      // (Pi stopped reporting), independent of any cloud API.
      try {
        const now = new Date();
        const { data: openOutages } = await supabase
          .from('controller_outage_log')
          .select('id, controller_id, outage_start')
          .eq('resolved', false);
        const openOutageMap = new Map((openOutages ?? []).map((o: any) => [o.controller_id, { id: o.id, outage_start: o.outage_start }]));

        for (const ctrl of controllerList) {
          if (ctrl.is_glycol_cooler) continue;
          const check = isSensorDataStale(ctrl.last_update);
          const hasOpenOutage = openOutageMap.has(ctrl.controller_id);

          if (check.stale && !hasOpenOutage) {
            await supabase.from('controller_outage_log').insert({
              controller_id: ctrl.controller_id,
              controller_name: ctrl.name,
              outage_start: ctrl.last_update || now.toISOString(),
            });
            const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
            const { data: recentOffline } = await supabase
              .from('pending_notifications')
              .select('id')
              .eq('type', 'sensor_offline')
              .eq('controller_id', ctrl.controller_id)
              .gte('created_at', oneHourAgo)
              .limit(1);
            if (!recentOffline?.length) {
              await insertNotification(supabase, {
                type: 'sensor_offline',
                title: `${ctrl.name}: Offline`,
                body: `Ingen sensordata på ${check.ageMinutes ?? '?'} minuter. Automatisk styrning pausad för denna enhet.`,
                controller_id: ctrl.controller_id,
              });
            }
            console.log(`📴 ${ctrl.name} went offline (${check.ageMinutes}min stale) — outage opened`);
          } else if (!check.stale && hasOpenOutage) {
            const outage = openOutageMap.get(ctrl.controller_id)!;
            const durationSeconds = Math.round((now.getTime() - new Date(outage.outage_start).getTime()) / 1000);
            await supabase.from('controller_outage_log').update({
              resolved: true,
              outage_end: now.toISOString(),
              duration_seconds: durationSeconds,
            }).eq('id', outage.id);
            console.log(`✅ ${ctrl.name} back online after ${Math.round(durationSeconds / 60)}min — outage resolved`);
          }
        }
      } catch (err) {
        console.error('Per-controller outage tracking error:', err);
      }
    };

    const snapshotTask = async () => {
      const { data: activeBrews } = await supabase
        .from('brew_readings')
        .select('id, current_sg, current_temp, last_update, linked_controller_id, status')
        .in('status', ['Jäsning', 'Fermenting']);
      if (!activeBrews?.length) return;

      const ctrlIds = activeBrews.map((b: any) => b.linked_controller_id).filter(Boolean);
      const { data: ctrls } = ctrlIds.length > 0
        ? await supabase.from('rapt_temp_controllers')
            .select('controller_id, current_temp, actual_temp, profile_target_temp, last_update, pill_temp')
            .in('controller_id', ctrlIds)
        : { data: [] as any[] };
      const ctrlMap = new Map((ctrls || []).map((c: any) => [c.controller_id, c]));

      let count = 0;
      for (const brew of activeBrews) {
        if (brew.current_sg == null) continue;
        const ctrl = ctrlMap.get(brew.linked_controller_id);
        await createBrewSnapshot(supabase, brew.id, {
          recorded_at: ctrl?.last_update || brew.last_update || new Date().toISOString(),
          sg: brew.current_sg,
          pill_temp: ctrl?.pill_temp ?? brew.current_temp ?? null,
          controller_temp: ctrl?.current_temp ?? null,
          profile_target_temp: ctrl?.profile_target_temp ?? null,
          actual_temp: ctrl?.actual_temp ?? null,
          controller_id: brew.linked_controller_id ?? null,
        });
        count++;
      }
      if (count > 0) console.log(`Created ${count} brew snapshot(s)`);
    };

    const [histResult, outageResult, snapResult] = await Promise.allSettled([tempHistoryTask(), outageTask(), snapshotTask()]);
    if (histResult.status === 'rejected') console.error('Temp history error:', histResult.reason);
    if (outageResult.status === 'rejected') console.error('Outage log error:', outageResult.reason);
    if (snapResult.status === 'rejected') console.error('Snapshot error:', snapResult.reason);

    // Dynamic sync frequency (sessions-driven only — no cloud automation left)
    try {
      const currentInterval = syncSettingsRow?.rapt_sync_interval ?? 300;
      const desiredInterval = hasActiveSessions ? 300 : 900;
      if (desiredInterval !== currentInterval && syncSettingsRow?.id) {
        await supabase.from('sync_settings').update({ rapt_sync_interval: desiredInterval }).eq('id', syncSettingsRow.id);
        console.log(`⏱️ Sync frequency changed: ${currentInterval}s → ${desiredInterval}s`);
      }
    } catch (e) {
      console.error('Sync frequency update error:', e);
    }

    console.log(`⏱️ Phase 3 (execute): ${Date.now() - tPhase3}ms`);
    console.log(`Quick sync complete: ${customBrewsUpdated} custom brews synced, ${controllerList.length} controllers`);

    return new Response(
      JSON.stringify({
        success: true,
        customBrewsUpdated,
        controllersTracked: controllerList.length,
        activeSessions: activeSessCheck?.length ?? 0,
        health: healthResult && !healthResult.__error ? healthResult.overall_status : null,
        duration_ms: Date.now() - syncStartTime,
      }),
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
