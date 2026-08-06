import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { computeAllMetrics } from '../_shared/fermentation-metrics-logic.ts';
import { computeSystemHealth } from '../_shared/system-health-logic.ts';
import { isSensorDataStale } from '../_shared/temp-utils.ts';
import { insertNotification } from '../_shared/notifications.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

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

    console.log('Starting quick sync (metrics/health + outage tracking)...');

    // Stamp timestamp immediately so the concurrency guard sees this run
    const nowIso = new Date().toISOString();
    if (syncSettingsRow?.id) {
      await supabase.from('sync_settings').update({ last_rapt_quick_sync_at: nowIso }).eq('id', syncSettingsRow.id);
    }

    // ──────────────────────────────────────────────────────
    // PHASE 2b: Display metrics + system health (read-only bookkeeping)
    // The Pi owns the fermentation profile engine and all regulation.
    // The cloud never advances steps or writes profile_target_temp.
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

      [metricsResult, healthResult] = await Promise.all([
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

      console.log(`⏱️ Phase 2b (metrics/health): ${Date.now() - tPhase2b}ms`);
    } else {
      console.log('⏱️ Phase 2b (metrics/health): SKIPPED — no active sessions');
    }

    // ──────────────────────────────────────────────────────
    // PHASE 3: Outage tracking only.
    // All temperatur- och gravity-data skrivs uteslutande av pi-telemetry
    // (30 s live + 3 min rollup). Molnet skriver ingen historik/snapshot här.
    // ──────────────────────────────────────────────────────
    console.log('Phase 3: Outage tracking...');
    const tPhase3 = Date.now();

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

    const [outageResult] = await Promise.allSettled([outageTask()]);
    if (outageResult.status === 'rejected') console.error('Outage log error:', outageResult.reason);

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
    console.log(`Quick sync complete: ${controllerList.length} controllers`);

    return new Response(
      JSON.stringify({
        success: true,
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
