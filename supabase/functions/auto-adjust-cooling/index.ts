import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { round1, TempController, setControllerTargetTemp, loadPillCompSettings, calculateCompensatedTarget } from '../_shared/temp-utils.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Type definitions for database records
interface AutoCoolingSettings {
  id: string;
  enabled: boolean;
  check_interval_minutes: number;
  temp_reduction_degrees: number;
  max_diff_from_lowest: number;
  cooler_controller_id: string | null;
  last_check_at: string | null;
  delta_alert_threshold: number;
  auto_boost_enabled: boolean;
  auto_boost_degrees: number;
  stall_rate_threshold: number;
  overshoot_prevention_enabled: boolean;
  overshoot_pill_threshold: number;
  overshoot_delta_threshold: number;
}

interface FollowedController {
  controller_id: string;
}

interface HistoryRecord {
  recorded_at: string;
  current_temp: number;
  target_temp: number;
  cooling_enabled: boolean;
}

interface DecisionLogEntry {
  step: string;
  result: 'pass' | 'fail' | 'info' | 'action';
  message: string;
  details?: Record<string, unknown>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const decisionLog: DecisionLogEntry[] = [];
  const startTime = Date.now();

  // Parse mode from request body: "all" | "tank-adjustments" | "glycol-cooler"
  let mode = "all";
  let tankAdjustments: Array<{ cooler: string; oldTarget: number; newTarget: number }> | null = null;
  try {
    const body = await req.json();
    mode = body?.mode || "all";
    tankAdjustments = body?.tankAdjustments || null;
  } catch { /* no body */ }

  const runTankAdjustments = mode === "all" || mode === "tank-adjustments";
  const runGlycolCooler = mode === "all" || mode === "glycol-cooler";

  const log = (step: string, result: 'pass' | 'fail' | 'info' | 'action', message: string, details?: Record<string, unknown>) => {
    const entry: DecisionLogEntry = { step, result, message, details };
    decisionLog.push(entry);
    const icon = result === 'pass' ? '✅' : result === 'fail' ? '❌' : result === 'action' ? '🔧' : 'ℹ️';
    console.log(`${icon} [${step}] ${message}`, details ? JSON.stringify(details) : '');
  };

  const printSummary = async (supabase: ReturnType<typeof createClient> | null, finalResult: string, adjustmentMade: boolean) => {
    const duration = Date.now() - startTime;
    console.log('\n' + '='.repeat(60));
    console.log('📊 AUTO-COOLING DECISION SUMMARY');
    console.log('='.repeat(60));
    console.log(`⏱️  Duration: ${duration}ms`);
    console.log(`📝 Total decisions: ${decisionLog.length}`);
    console.log(`🎯 Result: ${finalResult}`);
    console.log(`🔧 Adjustment made: ${adjustmentMade ? 'Yes' : 'No'}`);
    console.log('-'.repeat(60));
    
    decisionLog.forEach((entry, index) => {
      const icon = entry.result === 'pass' ? '✅' : entry.result === 'fail' ? '❌' : entry.result === 'action' ? '🔧' : 'ℹ️';
      console.log(`${index + 1}. ${icon} ${entry.step}: ${entry.message}`);
      if (entry.details) {
        Object.entries(entry.details).forEach(([key, value]) => {
          console.log(`      └─ ${key}: ${JSON.stringify(value)}`);
        });
      }
    });
    
    console.log('='.repeat(60) + '\n');

    // Only persist to DB on the final step (glycol-cooler or all), not on tank-adjustments
    if (supabase && mode !== "tank-adjustments") {
      try {
        await supabase.from('auto_cooling_decision_logs').insert({
          duration_ms: duration,
          decision_count: decisionLog.length,
          decisions: decisionLog,
          final_result: finalResult,
          adjustment_made: adjustmentMade
        } as any);
        console.log('Decision log saved to database');
      } catch (e) {
        console.error('Error saving decision log:', e);
      }
    }
  };

  let supabase: ReturnType<typeof createClient> | null = null;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    supabase = createClient(supabaseUrl, supabaseKey);

    log('START', 'info', 'Starting auto cooling adjustment check', { timestamp: new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit', second: '2-digit' }) });

    // Get settings
    const { data: settingsData, error: settingsError } = await supabase
      .from('auto_cooling_settings')
      .select('*')
      .limit(1)
      .single();

    const settings = settingsData as AutoCoolingSettings | null;

    if (settingsError || !settings) {
      log('SETTINGS', 'fail', 'Failed to fetch settings', { error: settingsError?.message });
      await printSummary(supabase, 'Settings error', false);
      return new Response(JSON.stringify({ message: 'Settings error', decisionLog }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if ANY feature is enabled
    const coolingEnabled = settings.enabled;
    const overshootEnabled = settings.overshoot_prevention_enabled ?? false;
    const stallEnabled = settings.auto_boost_enabled ?? false;

    log('SETTINGS', 'info', 'Feature toggles', {
      cooling: coolingEnabled,
      overshoot: overshootEnabled,
      stall_detection: stallEnabled,
    });

    if (!coolingEnabled && !overshootEnabled && !stallEnabled) {
      log('SETTINGS', 'fail', 'All features disabled');
      await printSummary(supabase, 'All disabled', false);
      return new Response(JSON.stringify({ message: 'All features disabled', decisionLog }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get followed controllers (needed by all features)
    const { data: followedData, error: followedError } = await supabase
      .from('auto_cooling_followed_controllers')
      .select('controller_id');

    const followedControllers = followedData as FollowedController[] | null;

    if (followedError || !followedControllers || followedControllers.length === 0) {
      log('FOLLOWED_CONTROLLERS', 'fail', 'No followed controllers configured');
      await printSummary(supabase, 'No followed controllers', false);
      return new Response(JSON.stringify({ message: 'No followed controllers', decisionLog }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const followedControllerIds = followedControllers.map(c => c.controller_id);
    log('FOLLOWED_CONTROLLERS', 'pass', `Found ${followedControllerIds.length} followed controller(s)`);

    // Get data for followed controllers (needed by all features)
    const { data: followedFullData, error: followedDataError } = await supabase
      .from('rapt_temp_controllers')
      .select('*')
      .in('controller_id', followedControllerIds);

    const followedControllersFullData = followedFullData as TempController[] | null;

    if (followedDataError || !followedControllersFullData || followedControllersFullData.length === 0) {
      log('FOLLOWED_DATA', 'fail', 'No followed controllers data found');
      await printSummary(supabase, 'No followed controllers data', false);
      return new Response(JSON.stringify({ message: 'No followed controllers data', decisionLog }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // NOTE: originalTargetMap is populated AFTER profileOwnedControllerIds is filled (below)
    // to avoid using stale historical targets for profile-owned controllers.
    const originalTargetMap = new Map<string, number>();

    // Log each followed controller's status — round1 imported from shared module

    // Build map of last adjusted_against_timestamp per controller — BATCHED single query
    const lastAdjTimestampMap = new Map<string, string>();
    {
      const allIds = followedControllersFullData.map(c => c.controller_id);
      const { data: allLastAdj } = await supabase
        .from('auto_cooling_adjustments')
        .select('cooler_controller_id, adjusted_against_timestamp, created_at')
        .in('cooler_controller_id', allIds)
        .not('adjusted_against_timestamp', 'is', null)
        .order('created_at', { ascending: false });
      
      // Keep only the most recent per controller
      if (allLastAdj) {
        for (const adj of allLastAdj) {
          if (!lastAdjTimestampMap.has(adj.cooler_controller_id)) {
            lastAdjTimestampMap.set(adj.cooler_controller_id, adj.adjusted_against_timestamp);
          }
        }
      }
    }

    // Store full data for logging after profile targets are resolved
    const followedDataForLog: Array<{controller: typeof followedControllersFullData[0], pillTemp: number|null, currentTemp: number, targetTemp: number, hysteresis: number, isActivelyCooling: boolean, pillDelta: number|null}> = [];
    followedControllersFullData.forEach(controller => {
      const pillTemp = round1(controller.pill_temp);
      const currentTemp = round1(controller.current_temp ?? controller.pill_temp) ?? 0;
      const targetTemp = round1(controller.target_temp) ?? 999;
      const hysteresis = parseFloat(String(controller.cooling_hysteresis ?? '0.2'));
      const isActivelyCooling = controller.cooling_enabled && currentTemp > (targetTemp + hysteresis);
      const pillDelta = pillTemp !== null ? round1(pillTemp - currentTemp) : null;
      followedDataForLog.push({controller, pillTemp, currentTemp, targetTemp, hysteresis, isActivelyCooling, pillDelta});
    });

    // Controllers with active fermentation profiles — profile owns the temperature
    const profileOwnedControllerIds = new Set<string>();
    // Map controller_id → profile target temp (the REAL goal, not the compensated controller target)
    const profileTargetMap = new Map<string, number>();
    // Check for 30-min cooloff after fermentation profile adjustments
    const cooloffControllerIds = new Set<string>();
    // Collect profile status per controller for consolidated logging
    const profileStatusMap = new Map<string, { profileTarget: number | null; stepIndex: number; hasCooloff: boolean; activeTarget?: number | null }>();
    // Always fetch profile data (needed for correct original_target in all modes)
    {
      const { data: runningSessions } = await supabase
        .from('fermentation_sessions')
        .select('id, controller_id, profile_id, current_step_index, step_started_at, step_start_temp')
        .eq('status', 'running')
        .in('controller_id', followedControllerIds);

      if (runningSessions && runningSessions.length > 0) {
        // Pre-check cooloff for all sessions if needed
        const cooloffSet = new Set<string>();
        if (runTankAdjustments) {
          const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
          const sessionIds = runningSessions.map(s => s.id);
          const { data: recentAdjs } = await supabase
            .from('fermentation_step_log')
            .select('session_id')
            .in('session_id', sessionIds)
            .eq('action', 'temp_adjusted')
            .gte('created_at', thirtyMinAgo);
          
          if (recentAdjs) {
            const sessionControllerMap = new Map(runningSessions.map(s => [s.id, s.controller_id]));
            for (const adj of recentAdjs) {
              const cId = sessionControllerMap.get(adj.session_id);
              if (cId) {
                cooloffSet.add(cId);
                cooloffControllerIds.add(cId);
              }
            }
          }
        }

        // Batch fetch all profile steps for all running sessions
        const uniqueProfileIds = [...new Set(runningSessions.map(s => s.profile_id))];
        const { data: allProfileSteps } = await supabase
          .from('fermentation_profile_steps')
          .select('profile_id, target_temp, step_order, step_type, duration_hours, ramp_type')
          .in('profile_id', uniqueProfileIds)
          .order('step_order', { ascending: true });
        
        const profileStepsMap = new Map<string, Array<{ target_temp: number | null; step_order: number; step_type: string; duration_hours: number | null; ramp_type: string | null }>>();
        if (allProfileSteps) {
          for (const step of allProfileSteps) {
            const list = profileStepsMap.get(step.profile_id) || [];
            list.push(step);
            profileStepsMap.set(step.profile_id, list);
          }
        }

        // ALL controllers with running sessions are profile-owned
        for (const session of runningSessions) {
          profileOwnedControllerIds.add(session.controller_id);
          
          let effectiveTarget: number | null = null;
          const profileSteps = profileStepsMap.get(session.profile_id);
          
          if (profileSteps && profileSteps.length > 0) {
            for (let i = Math.min(session.current_step_index, profileSteps.length - 1); i >= 0; i--) {
              if (profileSteps[i].target_temp !== null) {
                effectiveTarget = parseFloat(String(profileSteps[i].target_temp));
                break;
              }
            }
            if (effectiveTarget !== null) {
              profileTargetMap.set(session.controller_id, effectiveTarget);
            }
          }

          // Calculate interpolated ramp target if applicable
          let activeTarget: number | null = null;
          if (profileSteps && profileSteps.length > 0) {
            const currentStepIdx = Math.min(session.current_step_index, profileSteps.length - 1);
            const currentStep = profileSteps[currentStepIdx];
            if (currentStep.step_type === 'ramp' && currentStep.ramp_type !== 'immediate' && currentStep.duration_hours && currentStep.duration_hours > 0) {
              const stepStartTemp = session.step_start_temp != null ? parseFloat(String(session.step_start_temp)) : null;
              const stepTarget = currentStep.target_temp != null ? parseFloat(String(currentStep.target_temp)) : null;
              if (stepStartTemp != null && stepTarget != null && session.step_started_at) {
                const elapsedMs = Date.now() - new Date(session.step_started_at).getTime();
                const elapsedHours = elapsedMs / (1000 * 60 * 60);
                const progress = Math.min(elapsedHours / currentStep.duration_hours, 1);
                activeTarget = round1(stepStartTemp + (stepTarget - stepStartTemp) * progress);
              }
            }
          }

          profileStatusMap.set(session.controller_id, {
            profileTarget: effectiveTarget,
            stepIndex: session.current_step_index,
            hasCooloff: cooloffSet.has(session.controller_id),
            activeTarget,
          });
        }

        // Profile status is now included in FOLLOWED_DATA below
      }
    }

    // NOW populate originalTargetMap — after profileOwnedControllerIds is filled
    // BATCHED: single query for all non-profile-owned controllers
    {
      const nonProfileIds = followedControllersFullData
        .filter(c => !profileOwnedControllerIds.has(c.controller_id))
        .map(c => c.controller_id);
      
      if (nonProfileIds.length > 0) {
        const { data: allPrevAdj } = await supabase
          .from('auto_cooling_adjustments')
          .select('cooler_controller_id, old_target_temp, original_target_temp, created_at')
          .in('cooler_controller_id', nonProfileIds)
          .like('reason', '🌡️%')
          .order('created_at', { ascending: true });
        
        if (allPrevAdj) {
          // Keep the FIRST (oldest) per controller to find the original target
          for (const adj of allPrevAdj) {
            if (!originalTargetMap.has(adj.cooler_controller_id)) {
              originalTargetMap.set(adj.cooler_controller_id, adj.original_target_temp ?? adj.old_target_temp);
            }
          }
        }
      }
    }

    // Now log FOLLOWED_DATA with correct original_target (profile target takes precedence)
    for (const entry of followedDataForLog) {
      const { controller, pillTemp, currentTemp, targetTemp, isActivelyCooling, pillDelta } = entry;
      const profileTarget = profileTargetMap.get(controller.controller_id);
      const originalTarget = profileTarget !== undefined
        ? profileTarget
        : (round1(originalTargetMap.get(controller.controller_id) ?? null) ?? targetTemp);
      
      const profileInfo = profileStatusMap.get(controller.controller_id);
      const details: Record<string, unknown> = {
        original_target: originalTarget,
        last_update: controller.last_update
          ? new Date(controller.last_update).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : null,
        target_temp: targetTemp,
        current_temp: currentTemp,
        pill_temp: pillTemp,
        pill_delta: pillDelta,
        cooling_enabled: controller.cooling_enabled,
        is_actively_cooling: isActivelyCooling,
      };
      if (profileInfo) {
        details.profile_target = profileInfo.profileTarget;
        if (profileInfo.activeTarget != null && profileInfo.activeTarget !== profileInfo.profileTarget) {
          details.profile_active_target = profileInfo.activeTarget;
        }
        details.profile_step = profileInfo.stepIndex;
        if (profileInfo.hasCooloff) details.profile_cooloff = true;
      }
      log('FOLLOWED_DATA', 'info', `Controller: ${controller.name}`, details);
    }

    // PROFILE_STATUS removed — all profile info is now embedded in FOLLOWED_DATA above

    const allAdjustments: Array<{ cooler: string; oldTarget: number; newTarget: number }> = [];

    // Track which controllers stall detection has acted on (stall is prio 1, overshoot must not counteract)
    const stallActiveControllerIds = new Set<string>();

    // ====================================================================
    // FEATURE 1: STALL DETECTION (runs first - highest priority)
    // ====================================================================
    if (stallEnabled && runTankAdjustments) {
      log('STALL', 'info', '--- Fermentation stall detection check ---');

      for (const fc of followedControllersFullData) {
        // Skip controllers without active heating — stall boost raises temp which requires heating
        if (!fc.heating_enabled) {
          log('STALL_NO_HEATING', 'info', `${fc.name}: Hoppar över stall-check — värme ej aktiverad`);
          continue;
        }
        if (profileOwnedControllerIds.has(fc.controller_id)) {
          continue; // Covered by PROFILE_STATUS
        }
        if (cooloffControllerIds.has(fc.controller_id)) {
          log('STALL_COOLOFF', 'info', `${fc.name}: Hoppar över stall-check — 30min cooloff efter fermenteringsprofilsjustering`);
          continue;
        }

        const lastAdjTsStall = lastAdjTimestampMap.get(fc.controller_id);
        if (lastAdjTsStall && fc.last_update && lastAdjTsStall === fc.last_update) {
          log('SKIP_SAME_DATA', 'info', `${fc.name}: Samma data som senaste justering (${fc.last_update}), hoppar över (stall)`);
          continue;
        }

        const { data: linkedBrews } = await supabase
          .from('brew_readings')
          .select('batch_id, name, current_sg, original_gravity, final_gravity, sg_data, status, style')
          .eq('linked_controller_id', fc.controller_id)
          .in('status', ['Jäser', 'Jäsning', 'Fermenting'])
          .order('last_update', { ascending: false })
          .limit(1);

        if (!linkedBrews || linkedBrews.length === 0) {
          log('STALL_CHECK', 'info', `No active fermenting brew linked to ${fc.name}`);
          continue;
        }
        const brew = linkedBrews[0];

        const sgData = brew.sg_data as Array<{ date: string; value: number }> | null;
        if (!sgData || sgData.length < 3) {
          log('STALL_CHECK', 'info', `${brew.name}: Not enough SG data points (${sgData?.length ?? 0})`);
          continue;
        }

        const sorted = [...sgData].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const nowMs = Date.now();
        const last24h = sorted.filter(d => (nowMs - new Date(d.date).getTime()) < 24 * 60 * 60 * 1000);

        if (last24h.length < 2) {
          log('STALL_CHECK', 'info', `${brew.name}: Not enough data in last 24h (${last24h.length} points)`);
          continue;
        }

        const newest = last24h[0].value;
        const oldest = last24h[last24h.length - 1].value;
        const hoursSpan = (new Date(last24h[0].date).getTime() - new Date(last24h[last24h.length - 1].date).getTime()) / (1000 * 60 * 60);

        if (hoursSpan < 6) {
          log('STALL_CHECK', 'info', `${brew.name}: Time span too short (${hoursSpan.toFixed(1)}h < 6h required)`);
          continue;
        }

        const dailyRate = Math.abs(oldest - newest) * (24 / hoursSpan);
        const sgToFg = brew.current_sg - brew.final_gravity;
        const sgRange = brew.original_gravity - brew.final_gravity;
        const progressPct = sgRange > 0 ? ((brew.original_gravity - brew.current_sg) / sgRange) * 100 : 100;
        const stallThreshold = settings.stall_rate_threshold ?? 0.001;

        let effectiveThreshold = stallThreshold;
        let expectedSlowdown = false;
        if (progressPct > 90) {
          effectiveThreshold = stallThreshold * 0.3;
          expectedSlowdown = true;
        } else if (progressPct > 75) {
          effectiveThreshold = stallThreshold * 0.6;
        }

        log('STALL_CHECK', 'info', `${brew.name}: rate=${dailyRate.toFixed(4)}/day, SG=${brew.current_sg.toFixed(3)}, OG=${brew.original_gravity.toFixed(3)}, FG=${brew.final_gravity.toFixed(3)}, progress=${progressPct.toFixed(0)}%`, {
          daily_rate: dailyRate,
          daily_rate_display: `${dailyRate.toFixed(4)} SG/day`,
          og: brew.original_gravity,
          fg: brew.final_gravity,
          current_sg: brew.current_sg,
          sg_to_fg: parseFloat(sgToFg.toFixed(4)),
          progress_pct: parseFloat(progressPct.toFixed(1)),
          threshold: stallThreshold,
          effective_threshold: effectiveThreshold,
          expected_slowdown: expectedSlowdown,
          pill_temp: round1(fc.pill_temp),
          current_temp: round1(fc.current_temp),
          target_temp: round1(fc.target_temp),
        });

        const isStalling = dailyRate < effectiveThreshold && sgToFg > 0.005 && progressPct < 95;

        if (!isStalling) {
          if (expectedSlowdown && progressPct >= 95) {
            log('STALL_CHECK', 'pass', `${brew.name}: Natural slowdown near FG (${progressPct.toFixed(0)}% done, SG ${sgToFg.toFixed(4)} from FG)`);
          } else if (expectedSlowdown) {
            log('STALL_CHECK', 'pass', `${brew.name}: Rate OK for late fermentation (effective threshold: ${effectiveThreshold.toFixed(4)})`);
          } else {
            log('STALL_CHECK', 'pass', `${brew.name}: No stall (rate ${dailyRate.toFixed(4)}/day vs threshold ${effectiveThreshold.toFixed(4)})`);
          }
          continue;
        }

        log('STALL_DETECTED', 'action', `Fermentation stall detected for ${brew.name}! Rate ${dailyRate.toFixed(4)}/day, ${(100 - progressPct).toFixed(0)}% remaining`);

        // Create stall alert
        const { data: existingStallAlerts } = await supabase
          .from('temp_delta_alerts')
          .select('id')
          .eq('controller_id', fc.controller_id)
          .eq('alert_type', 'fermentation_stall')
          .eq('acknowledged', false)
          .limit(1);

        if (!existingStallAlerts || existingStallAlerts.length === 0) {
          await supabase.from('temp_delta_alerts').insert({
            controller_id: fc.controller_id,
            delta: dailyRate,
            alert_type: 'fermentation_stall'
          } as any);
          log('STALL_ALERT', 'pass', `Stall alert created for ${fc.name}: rate=${dailyRate.toFixed(4)}/day`);
        }

        // --- 12h time guard: max one boost per 12 hours per controller ---
        const STALL_BOOST_COOLDOWN_MS = 12 * 60 * 60 * 1000;
        const { data: lastStallBoost } = await supabase
          .from('auto_cooling_adjustments')
          .select('created_at')
          .eq('cooler_controller_id', fc.controller_id)
          .like('reason', 'Jäsning stannat%')
          .order('created_at', { ascending: false })
          .limit(1);

        if (lastStallBoost && lastStallBoost.length > 0) {
          const timeSinceBoost = Date.now() - new Date(lastStallBoost[0].created_at).getTime();
          if (timeSinceBoost < STALL_BOOST_COOLDOWN_MS) {
            const remainingH = ((STALL_BOOST_COOLDOWN_MS - timeSinceBoost) / 3600000).toFixed(1);
            log('STALL_TIMEGUARD', 'info', `${fc.name}: Boost redan gjord inom 12h (${remainingH}h kvar), hoppar över`);
            continue;
          }
        }

        // --- Style-based boost degrees ---
        const style = (brew.style || '').toLowerCase();
        let boostDegrees: number;
        if (/lager|pilsner|k[öo]lsch/.test(style)) {
          boostDegrees = 0.5;
        } else if (/belgian|saison|farmhouse/.test(style)) {
          boostDegrees = 1.5;
        } else {
          boostDegrees = settings.auto_boost_degrees ?? 1.0;
        }

        const currentTarget = parseFloat(String(fc.target_temp ?? '20'));
        const newTarget = Math.round((currentTarget + boostDegrees) * 10) / 10;
        const maxTemp = parseFloat(String(fc.max_target_temp ?? '25'));

        if (newTarget > maxTemp) {
          log('STALL_BOOST_SKIP', 'info', `${fc.name}: Boost ${newTarget}°C överstiger max ${maxTemp}°C`);
          continue;
        }

        log('STALL_BOOST', 'action', `Boosting ${fc.name} from ${currentTarget}°C to ${newTarget}°C (+${boostDegrees}°C, style=${brew.style || 'standard'})`);

        const stallSuccess = await setControllerTargetTemp(supabaseUrl, supabaseKey, fc.controller_id, newTarget);

        if (stallSuccess) {
          log('STALL_BOOST', 'pass', `Successfully set ${fc.name} to ${newTarget}°C`);
          allAdjustments.push({ cooler: fc.name, oldTarget: currentTarget, newTarget });
          stallActiveControllerIds.add(fc.controller_id);

          await supabase.from('auto_cooling_adjustments').insert({
            cooler_controller_id: fc.controller_id,
            cooler_controller_name: fc.name,
            old_target_temp: currentTarget,
            new_target_temp: newTarget,
            lowest_followed_temp: currentTarget,
            followed_controller_id: fc.controller_id,
            followed_controller_name: fc.name,
            followed_current_temp: parseFloat(String(fc.current_temp ?? fc.pill_temp ?? '0')),
            followed_target_temp: currentTarget,
            reason: `Jäsning stannat (${dailyRate.toFixed(4)}/dag, ${(100 - progressPct).toFixed(0)}% kvar) — stilboost +${boostDegrees}°C (${brew.style || 'standard'})`,
            adjusted_against_timestamp: fc.last_update
          } as any);
        } else {
          log('STALL_BOOST', 'fail', `Failed to update ${fc.name}`);
        }
      }
    } else {
      log('STALL', 'info', 'Stall detection disabled');
    }

    // ====================================================================
    // FEATURE 2: OVERSHOOT PREVENTION (runs after stall - skips if stall acted)
    // ====================================================================
    if (overshootEnabled && runTankAdjustments) {
      log('OVERSHOOT', 'info', '--- Overshoot prevention check ---');

      const OVERSHOOT_COOLDOWN_MS = 10 * 60 * 1000;
      const overshootPillThreshold = parseFloat(String(settings.overshoot_pill_threshold ?? 0.3));
      const overshootDeltaThreshold = parseFloat(String(settings.overshoot_delta_threshold ?? 2.0));

      // Batch: fetch latest overshoot adjustment per controller for cooldown check
      const overshootCooldownMap = new Map<string, number>();
      {
        const { data: allOvershootAdj } = await supabase
          .from('auto_cooling_adjustments')
          .select('cooler_controller_id, created_at')
          .in('cooler_controller_id', followedControllerIds)
          .like('reason', '🌡️%')
          .order('created_at', { ascending: false });
        
        if (allOvershootAdj) {
          for (const adj of allOvershootAdj) {
            if (!overshootCooldownMap.has(adj.cooler_controller_id)) {
              overshootCooldownMap.set(adj.cooler_controller_id, new Date(adj.created_at).getTime());
            }
          }
        }
      }

      for (const fc of followedControllersFullData) {
        // Per-controller cooldown check (from batched data)
        const lastOvershootTime = overshootCooldownMap.get(fc.controller_id);
        if (lastOvershootTime) {
          const timeSinceLastAdj = Date.now() - lastOvershootTime;
          if (timeSinceLastAdj < OVERSHOOT_COOLDOWN_MS) {
            const remainingMin = ((OVERSHOOT_COOLDOWN_MS - timeSinceLastAdj) / 60000).toFixed(1);
            log('OVERSHOOT_COOLDOWN', 'info', `${fc.name}: Cooldown active: ${remainingMin}min remaining`);
            continue;
          }
        }

        if (fc.pill_temp === null || fc.pill_temp === undefined || fc.current_temp === null || fc.current_temp === undefined) continue;
        if (fc.target_temp === null || fc.target_temp === undefined) continue;

        const lastAdjTs = lastAdjTimestampMap.get(fc.controller_id);
        if (lastAdjTs && fc.last_update && lastAdjTs === fc.last_update) {
          log('SKIP_SAME_DATA', 'info', `${fc.name}: Samma data som senaste justering (${fc.last_update}), hoppar över`);
          continue;
        }

        if (cooloffControllerIds.has(fc.controller_id)) {
          continue; // Covered by PROFILE_STATUS
        }

        // Skip controllers without active heating — overshoot is a heating phenomenon
        if (!fc.heating_enabled) {
          log('OVERSHOOT_NO_HEATING', 'info', `Skipping overshoot for ${fc.name}: heating not enabled`);
          continue;
        }

        if (stallActiveControllerIds.has(fc.controller_id)) {
          log('OVERSHOOT_SKIP_STALL', 'info', `Skipping overshoot for ${fc.name}: stall detection acted this run`);
          continue;
        }

        const pillTemp = parseFloat(String(fc.pill_temp));
        const ctrlTemp = parseFloat(String(fc.current_temp));
        const targetTemp = parseFloat(String(fc.target_temp));
        const pillDelta = pillTemp - ctrlTemp;

        // CRITICAL: For profile-owned controllers, use the PROFILE target as baseline for overshoot detection.
        const isProfileOwned = profileOwnedControllerIds.has(fc.controller_id);
        const profileTarget = profileTargetMap.get(fc.controller_id);
        const originalTarget = isProfileOwned && profileTarget !== undefined
          ? profileTarget
          : (originalTargetMap.get(fc.controller_id) ?? targetTemp);

        log('OVERSHOOT_ORIGINAL_TARGET', 'info', `${fc.name}: overshoot baseline=${originalTarget}°C (${isProfileOwned ? `profile-mål=${profileTarget}°C` : 'originalTargetMap'}), current target=${targetTemp}°C`);

        const pillOverTarget = pillTemp >= originalTarget + overshootPillThreshold;
        const isHeatingOvershoot = pillOverTarget && pillDelta > overshootDeltaThreshold;

        if (isHeatingOvershoot) {
          log('OVERSHOOT_DETECTED', 'action', `Heating overshoot for ${fc.name}: pill=${pillTemp.toFixed(1)}° > original=${originalTarget}°C, ctrl=${ctrlTemp.toFixed(1)}° (delta=${pillDelta.toFixed(1)}°)`);

          // --- Deterministic midpoint formula (replaces AI call) ---
          const maxTemp = parseFloat(String(fc.max_target_temp ?? '25'));
          const minTemp = parseFloat(String(fc.min_target_temp ?? '-5'));
          const coolingHyst = parseFloat(String(fc.cooling_hysteresis ?? 0.2));
          const coolingFloor = Math.round((ctrlTemp + coolingHyst + 0.1) * 10) / 10;
          const midpoint = Math.round(((ctrlTemp + originalTarget) / 2) * 10) / 10;
          let newTarget = Math.max(midpoint, coolingFloor);

          log('OVERSHOOT_CALC', 'info', `Midpoint=${midpoint}°C (ctrl=${ctrlTemp.toFixed(1)}° ↔ original=${originalTarget}°C), coolingFloor=${coolingFloor}°C, chosen=${newTarget}°C`);

          newTarget = Math.min(newTarget, targetTemp);
          newTarget = Math.max(minTemp, Math.min(maxTemp, newTarget));

          if (Math.abs(newTarget - targetTemp) < 0.1) {
            log('OVERSHOOT_SKIP', 'info', `Target already at ${targetTemp}°C, no change needed`);
          } else {
            log('OVERSHOOT_ACTION', 'action', `Setting ${fc.name} from ${targetTemp}°C → ${newTarget}°C`);
            const overshootSuccess = await setControllerTargetTemp(supabaseUrl, supabaseKey, fc.controller_id, newTarget);
            if (overshootSuccess) {
              log('OVERSHOOT_ACTION', 'pass', `Successfully set ${fc.name} to ${newTarget}°C`);
              allAdjustments.push({ cooler: fc.name, oldTarget: targetTemp, newTarget });
              await supabase.from('auto_cooling_adjustments').insert({
                cooler_controller_id: fc.controller_id,
                cooler_controller_name: fc.name,
                old_target_temp: targetTemp,
                new_target_temp: newTarget,
                original_target_temp: originalTarget,
                lowest_followed_temp: originalTarget,
                followed_controller_id: fc.controller_id,
                followed_controller_name: fc.name,
                followed_current_temp: ctrlTemp,
                followed_target_temp: originalTarget,
                reason: `🌡️ Overshoot: pill ${pillTemp.toFixed(1)}°C > mål ${originalTarget}°C, midpoint-sänkning`,
                adjusted_against_timestamp: fc.last_update
              } as any);
            } else {
              log('OVERSHOOT_ACTION', 'fail', `Failed to update ${fc.name}`);
            }
          }
        }

        // ---- OVERSHOOT RECOVERY (unchanged) ----
        if (!stallActiveControllerIds.has(fc.controller_id) && !isHeatingOvershoot && !profileOwnedControllerIds.has(fc.controller_id) && fc.heating_enabled) {
          const origTarget = originalTargetMap.get(fc.controller_id);
          if (origTarget !== undefined && targetTemp < origTarget) {
            if (pillTemp < origTarget + overshootPillThreshold) {
              const maxTemp = parseFloat(String(fc.max_target_temp ?? '25'));
              const minTemp = parseFloat(String(fc.min_target_temp ?? '-5'));
              const recoveryTarget = Math.max(minTemp, Math.min(maxTemp, origTarget));

              if (Math.abs(recoveryTarget - targetTemp) >= 0.1) {
                log('OVERSHOOT_RECOVERY', 'action', `Restoring ${fc.name} from ${targetTemp}°C back to original ${recoveryTarget}°C (pill=${pillTemp.toFixed(1)}°C)`);
                const recoverySuccess = await setControllerTargetTemp(supabaseUrl, supabaseKey, fc.controller_id, recoveryTarget);
                if (recoverySuccess) {
                  log('OVERSHOOT_RECOVERY', 'pass', `Restored ${fc.name} to ${recoveryTarget}°C`);
                  allAdjustments.push({ cooler: fc.name, oldTarget: targetTemp, newTarget: recoveryTarget });
                  await supabase.from('auto_cooling_adjustments').insert({
                    cooler_controller_id: fc.controller_id,
                    cooler_controller_name: fc.name,
                    old_target_temp: targetTemp,
                    new_target_temp: recoveryTarget,
                    original_target_temp: origTarget,
                    lowest_followed_temp: origTarget,
                    followed_controller_id: fc.controller_id,
                    followed_controller_name: fc.name,
                    followed_current_temp: ctrlTemp,
                    followed_target_temp: origTarget,
                    reason: `🔄 Overshoot recovery: pill ${pillTemp.toFixed(1)}°C tillbaka under ${(origTarget + overshootPillThreshold).toFixed(1)}°C, återställer mål`,
                    adjusted_against_timestamp: fc.last_update
                  } as any);
                } else {
                  log('OVERSHOOT_RECOVERY', 'fail', `Failed to restore ${fc.name}`);
                }
              }
            }
          }
        }
      }
    } else {
      log('OVERSHOOT', 'info', 'Overshoot prevention disabled');
    }

    // ====================================================================
    // FEATURE 2.5: STANDALONE PILL COMPENSATION (for non-profile controllers)
    // Adjusts target temp to account for pill-probe delta so the average
    // of surface (pill) and core (probe) equals the intended target.
    // ====================================================================
    const pillCompSettings = await loadPillCompSettings(supabase);
    if (pillCompSettings.enabled && runTankAdjustments) {
      log('PILL_COMP', 'info', '--- Standalone pill compensation check ---');

      // Build map of original targets for pill-comp (from 🎯 adjustments)
      const pillCompOriginalTargetMap = new Map<string, number>();
      {
        const nonProfileIds = followedControllersFullData
          .filter(c => !profileOwnedControllerIds.has(c.controller_id))
          .map(c => c.controller_id);

        if (nonProfileIds.length > 0) {
          const { data: pillCompAdj } = await supabase
            .from('auto_cooling_adjustments')
            .select('cooler_controller_id, original_target_temp, created_at')
            .in('cooler_controller_id', nonProfileIds)
            .like('reason', '🎯%')
            .order('created_at', { ascending: true });

          if (pillCompAdj) {
            for (const adj of pillCompAdj) {
              if (!pillCompOriginalTargetMap.has(adj.cooler_controller_id) && adj.original_target_temp != null) {
                pillCompOriginalTargetMap.set(adj.cooler_controller_id, parseFloat(String(adj.original_target_temp)));
              }
            }
          }
        }
      }

      for (const fc of followedControllersFullData) {
        // Skip profile-owned controllers — handled by process-fermentation-profiles
        if (profileOwnedControllerIds.has(fc.controller_id)) {
          continue;
        }

        // Skip if stall just acted
        if (stallActiveControllerIds.has(fc.controller_id)) {
          log('PILL_COMP_SKIP', 'info', `${fc.name}: Stall detection acted this run, skipping pill-comp`);
          continue;
        }

        // Skip cooloff controllers
        if (cooloffControllerIds.has(fc.controller_id)) {
          log('PILL_COMP_SKIP', 'info', `${fc.name}: 30min cooloff active, skipping pill-comp`);
          continue;
        }

        // Must have heating OR cooling active
        if (!fc.heating_enabled && !fc.cooling_enabled) {
          continue;
        }

        // Must have pill data
        if (fc.pill_temp === null || fc.pill_temp === undefined) {
          continue;
        }

        // Same-data guard
        const lastAdjTs = lastAdjTimestampMap.get(fc.controller_id);
        if (lastAdjTs && fc.last_update && lastAdjTs === fc.last_update) {
          log('PILL_COMP_SKIP', 'info', `${fc.name}: Samma data som senaste justering (${fc.last_update}), hoppar över`);
          continue;
        }

        const targetTemp = parseFloat(String(fc.target_temp ?? '20'));

        // Determine the "base target" — the intended goal before any pill-comp
        // Use saved original_target from previous pill-comp adjustments, or current target
        const baseTarget = pillCompOriginalTargetMap.get(fc.controller_id) ?? targetTemp;

        const compensation = await calculateCompensatedTarget(
          supabase, fc.controller_id, baseTarget, targetTemp,
          fc.name || fc.controller_id, pillCompSettings
        );

        if (!compensation) {
          continue;
        }

        // Safety bounds
        const maxTemp = parseFloat(String(fc.max_target_temp ?? '25'));
        const minTemp = parseFloat(String(fc.min_target_temp ?? '-5'));
        let newTarget = Math.max(minTemp, Math.min(maxTemp, compensation.compensatedTarget));

        if (Math.abs(newTarget - targetTemp) < 0.1) {
          continue;
        }

        log('PILL_COMP_ACTION', 'action', `${fc.name}: pill-komp ${baseTarget.toFixed(1)}°C → ${newTarget.toFixed(1)}°C (delta=${compensation.avgDelta.toFixed(2)}, komp=${compensation.compensation.toFixed(2)}°C)`);

        const success = await setControllerTargetTemp(supabaseUrl, supabaseKey, fc.controller_id, newTarget);

        if (success) {
          log('PILL_COMP_ACTION', 'pass', `Set ${fc.name} to ${newTarget}°C`);
          allAdjustments.push({ cooler: fc.name, oldTarget: targetTemp, newTarget });

          await supabase.from('rapt_temp_controllers')
            .update({ target_temp: newTarget, updated_at: new Date().toISOString() })
            .eq('controller_id', fc.controller_id);

          await supabase.from('auto_cooling_adjustments').insert({
            cooler_controller_id: fc.controller_id,
            cooler_controller_name: fc.name,
            old_target_temp: targetTemp,
            new_target_temp: newTarget,
            original_target_temp: baseTarget,
            lowest_followed_temp: baseTarget,
            followed_controller_id: fc.controller_id,
            followed_controller_name: fc.name,
            followed_current_temp: parseFloat(String(fc.pill_temp ?? fc.current_temp ?? '0')),
            followed_target_temp: parseFloat(String(fc.current_temp ?? '0')),
            followed_hysteresis: compensation.avgDelta,
            reason: `🎯 Pill-kompensation: ${baseTarget.toFixed(1)}°C → ${newTarget.toFixed(1)}°C (delta=${compensation.avgDelta.toFixed(2)}, komp=${compensation.compensation.toFixed(2)}°C)`,
            adjusted_against_timestamp: fc.last_update,
          } as any);
        } else {
          log('PILL_COMP_ACTION', 'fail', `Failed to update ${fc.name}`);
        }
      }
    } else if (!pillCompSettings.enabled) {
      log('PILL_COMP', 'info', 'Pill compensation disabled');
    }

    // ====================================================================
    // FEATURE 3: AUTO COOLING ADJUSTMENT (runs last)
    // ====================================================================
    if (coolingEnabled && runGlycolCooler) {
      log('COOLING', 'info', '--- Auto cooling adjustment check ---');

      if (!settings.cooler_controller_id) {
        log('COOLER_CONFIG', 'fail', 'No cooler controller configured');
      } else {
        // Get cooler controller data
        const { data: coolerData, error: coolerError } = await supabase
          .from('rapt_temp_controllers')
          .select('*')
          .eq('controller_id', settings.cooler_controller_id)
          .eq('cooling_enabled', true)
          .single();

        const coolerController = coolerData as TempController | null;

        if (coolerError || !coolerController) {
          log('COOLER_STATUS', 'fail', 'Cooler controller not found or cooling not enabled');
        } else {
          log('COOLER_STATUS', 'pass', `Cooler: ${coolerController.name}`, {
            target_temp: round1(coolerController.target_temp),
            current_temp: round1(coolerController.current_temp)
          });

          const currentCoolerTarget = parseFloat(String(coolerController.target_temp ?? '18'));

          // Check if any followed controller has cooling enabled
          const controllersWithCooling = followedControllersFullData.filter(c => c.cooling_enabled === true);

          if (controllersWithCooling.length === 0) {
            log('COOLING_CAPABILITY', 'fail', 'No followed controller has cooling enabled');

            const defaultTemp = 18;
            if (Math.abs(currentCoolerTarget - defaultTemp) > 0.1) {
              const coolerMinTemp = parseFloat(String(coolerController.min_target_temp ?? '-5'));
              const coolerMaxTemp = parseFloat(String(coolerController.max_target_temp ?? '25'));

              if (defaultTemp >= coolerMinTemp && defaultTemp <= coolerMaxTemp) {
                log('ADJUSTMENT', 'action', `Setting cooler to default ${defaultTemp}°C`);

                const defaultSuccess = await setControllerTargetTemp(supabaseUrl, supabaseKey, coolerController.controller_id, defaultTemp);

                if (defaultSuccess) {
                  log('ADJUSTMENT', 'pass', `Set cooler to ${defaultTemp}°C`);

                  await supabase.from('auto_cooling_adjustments').insert({
                    cooler_controller_id: coolerController.controller_id,
                    cooler_controller_name: coolerController.name,
                    old_target_temp: currentCoolerTarget,
                    new_target_temp: defaultTemp,
                    lowest_followed_temp: 0,
                    reason: 'Ingen följd controller är aktiv med kyla'
                  } as any);

                  allAdjustments.push({ cooler: coolerController.name, oldTarget: currentCoolerTarget, newTarget: defaultTemp });
                }
              }
            }
          } else {
            log('COOLING_CAPABILITY', 'pass', `${controllersWithCooling.length} controller(s) have cooling enabled`);

            // Apply fresh tankAdjustments from orchestrator (step 2 may have changed targets)
            if (tankAdjustments && tankAdjustments.length > 0) {
              for (const adj of tankAdjustments) {
                const match = followedControllersFullData.find(c => c.name === adj.cooler);
                if (match) {
                  log('TANK_ADJ_APPLY', 'info', `Applying fresh target from step 2: ${match.name} ${match.target_temp}→${adj.newTarget}°C`);
                  (match as any).target_temp = adj.newTarget;
                }
              }
            }

            // Find the controller with the lowest target temperature AMONG those with cooling enabled
            const lowestTempController = controllersWithCooling.reduce((lowest, current) => {
              const currentTarget = parseFloat(String(current.target_temp ?? '999'));
              const lowestTarget = parseFloat(String(lowest.target_temp ?? '999'));
              return currentTarget < lowestTarget ? current : lowest;
            });

            const lowestTargetTemp = parseFloat(String(lowestTempController.target_temp ?? '999'));

            log('LOWEST_CONTROLLER', 'info', `Lowest target with cooling: ${lowestTempController.name}`, {
              target_temp: round1(lowestTargetTemp),
              cooler_target: round1(currentCoolerTarget),
              diff: round1(currentCoolerTarget - lowestTargetTemp)
            });

            // Temperature difference analysis
            const tempDiff = currentCoolerTarget - lowestTargetTemp;

            // Check if cooler is more than 10 degrees COLDER
            if (tempDiff < -10) {
              log('OVERCOOLING_CHECK', 'info', `Cooler is ${Math.abs(tempDiff).toFixed(1)}°C colder than lowest`);

              const newTarget = lowestTargetTemp - 10;
              const coolerMinTemp = parseFloat(String(coolerController.min_target_temp ?? '-5'));
              const coolerMaxTemp = parseFloat(String(coolerController.max_target_temp ?? '25'));

              if (newTarget > currentCoolerTarget && newTarget >= coolerMinTemp && newTarget <= coolerMaxTemp) {
                log('ADJUSTMENT', 'action', `Increasing cooler from ${currentCoolerTarget}°C to ${newTarget}°C`);

                const overCoolSuccess = await setControllerTargetTemp(supabaseUrl, supabaseKey, coolerController.controller_id, newTarget);

                if (overCoolSuccess) {
                  log('ADJUSTMENT', 'pass', `Increased cooler to ${newTarget}°C`);

                  await supabase.from('auto_cooling_adjustments').insert({
                    cooler_controller_id: coolerController.controller_id,
                    cooler_controller_name: coolerController.name,
                    old_target_temp: currentCoolerTarget,
                    new_target_temp: newTarget,
                    lowest_followed_temp: lowestTargetTemp,
                    followed_controller_id: lowestTempController.controller_id,
                    followed_controller_name: lowestTempController.name,
                    followed_current_temp: parseFloat(String(lowestTempController.current_temp ?? lowestTempController.pill_temp ?? '0')),
                    followed_target_temp: lowestTargetTemp,
                    followed_hysteresis: parseFloat(String(lowestTempController.cooling_hysteresis ?? '0.2')),
                    reason: `Cooler was ${Math.abs(tempDiff).toFixed(1)}°C colder than needed`
                  } as any);

                  allAdjustments.push({ cooler: coolerController.name, oldTarget: currentCoolerTarget, newTarget });
                }
              }
            }

            // Check if lowest controller is actively cooling
            const lowestCurrentTemp = parseFloat(String(lowestTempController.current_temp ?? lowestTempController.pill_temp ?? '0'));
            const lowestHysteresis = parseFloat(String(lowestTempController.cooling_hysteresis ?? '0.2'));
            const coolingThreshold = lowestTargetTemp + lowestHysteresis;
            const isActivelyCooling = lowestCurrentTemp > coolingThreshold;

            log('ACTIVE_COOLING_CHECK', isActivelyCooling ? 'pass' : 'info',
              isActivelyCooling ? `${lowestTempController.name} IS actively cooling` : `${lowestTempController.name} is NOT actively cooling`, {
              current_temp: round1(lowestCurrentTemp),
              threshold: round1(coolingThreshold)
            });

            if (isActivelyCooling) {
              // Check interval
              const now = new Date();
              const checkIntervalMs = settings.check_interval_minutes * 60 * 1000;

              let intervalPassed = true;
              if (settings.last_check_at) {
                const lastCheckTime = new Date(settings.last_check_at);
                const timeSinceLastCheck = now.getTime() - lastCheckTime.getTime();
                const remainingMs = checkIntervalMs - timeSinceLastCheck;

                if (timeSinceLastCheck < checkIntervalMs) {
                  const remainingMinutes = Math.ceil(remainingMs / 60000);
                  log('INTERVAL_CHECK', 'fail', `Must wait ${remainingMinutes} more minutes`);
                  intervalPassed = false;
                } else {
                  log('INTERVAL_CHECK', 'pass', 'Enough time has passed');
                }
              } else {
                log('INTERVAL_CHECK', 'pass', 'No previous check recorded');
              }

              if (intervalPassed) {
                // Check history
                const checkTime = new Date(Date.now() - settings.check_interval_minutes * 60 * 1000);

                const { data: historyData, error: historyError } = await supabase
                  .from('temp_controller_history')
                  .select('*')
                  .eq('controller_id', lowestTempController.controller_id)
                  .gte('recorded_at', checkTime.toISOString())
                  .order('recorded_at', { ascending: false });

                const history = historyData as HistoryRecord[] | null;

                if (historyError || !history || history.length < 2) {
                  log('HISTORY_CHECK', 'fail', 'Not enough history data', { records_found: history?.length ?? 0 });
                } else {
                  log('HISTORY_CHECK', 'pass', `Found ${history.length} history records`);

                  const allActivelyCooling = history.every(record => {
                    return record.cooling_enabled === true && record.current_temp > (record.target_temp + lowestHysteresis);
                  });

                  log('SUSTAINED_COOLING_CHECK', allActivelyCooling ? 'pass' : 'fail',
                    allActivelyCooling ? 'Controller has been trying to cool for entire interval' : 'Controller was NOT actively cooling for entire interval');

                  if (allActivelyCooling) {
                    log('DECISION', 'action', `${lowestTempController.name} has been struggling to cool`, {
                      current_temp: lowestCurrentTemp,
                      target_temp: lowestTargetTemp
                    });

                    await (supabase as any).from('auto_cooling_settings').update({ last_check_at: new Date().toISOString() }).eq('id', settings.id);

                    // === DELTA ANALYSIS ===
                    let deltaMultiplier = 1.0;

                    // Batch: fetch recent delta history for all followed controllers (last 24h)
                    const batchDeltaMap = new Map<string, Array<{ delta: number; recorded_at: string }>>();
                    {
                      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
                      const { data: allDeltaHistory } = await supabase
                        .from('temp_delta_history')
                        .select('controller_id, delta, recorded_at')
                        .in('controller_id', followedControllerIds)
                        .gte('recorded_at', twentyFourHoursAgo)
                        .order('recorded_at', { ascending: false });
                      
                      if (allDeltaHistory) {
                        for (const d of allDeltaHistory) {
                          const list = batchDeltaMap.get(d.controller_id) || [];
                          if (list.length < 5) list.push(d);
                          batchDeltaMap.set(d.controller_id, list);
                        }
                      }
                    }

                    // Batch: fetch all unacknowledged delta alerts for followed controllers
                    const existingAlertControllerIds = new Set<string>();
                    {
                      const { data: allAlerts } = await supabase
                        .from('temp_delta_alerts')
                        .select('controller_id')
                        .in('controller_id', followedControllerIds)
                        .eq('acknowledged', false);
                      
                      if (allAlerts) {
                        for (const a of allAlerts) existingAlertControllerIds.add(a.controller_id);
                      }
                    }

                    for (const fc of followedControllersFullData) {
                      if (fc.pill_temp === null || fc.pill_temp === undefined || fc.current_temp === null || fc.current_temp === undefined) continue;

                      const pillTemp = parseFloat(String(fc.pill_temp));
                      const ctrlTemp = parseFloat(String(fc.current_temp));
                      const currentDelta = pillTemp - ctrlTemp;

                      log('DELTA_ANALYSIS', 'info', `${fc.name}: pill=${pillTemp.toFixed(1)}° ctrl=${ctrlTemp.toFixed(1)}° delta=${currentDelta >= 0 ? '+' : ''}${currentDelta.toFixed(1)}°`);

                      const deltaHistory = batchDeltaMap.get(fc.controller_id);

                      if (deltaHistory && deltaHistory.length >= 2) {
                        const recentDeltas = deltaHistory.map(d => parseFloat(String(d.delta)));
                        const avgRecentDelta = recentDeltas.slice(0, 2).reduce((a, b) => a + b, 0) / 2;
                        const avgOlderDelta = recentDeltas.slice(2).reduce((a, b) => a + b, 0) / Math.max(recentDeltas.length - 2, 1);
                        const deltaRising = avgRecentDelta > avgOlderDelta + 0.1;

                        if (deltaRising) {
                          deltaMultiplier = Math.max(deltaMultiplier, 1.5);
                          log('DELTA_TREND', 'action', `Delta RISING for ${fc.name} (${avgOlderDelta.toFixed(1)}° → ${avgRecentDelta.toFixed(1)}°)`);
                        }
                      }

                      if (currentDelta > 1.5) {
                        deltaMultiplier = Math.max(deltaMultiplier, 2.0);
                        log('DELTA_HIGH', 'action', `High delta (${currentDelta.toFixed(1)}°) for ${fc.name} — doubling reduction`);
                      }

                      // Generate alert if delta exceeds threshold
                      const alertThreshold = settings.delta_alert_threshold ?? 2.0;
                      if (currentDelta > alertThreshold && !existingAlertControllerIds.has(fc.controller_id)) {
                        await supabase.from('temp_delta_alerts').insert({
                          controller_id: fc.controller_id,
                          delta: currentDelta,
                          alert_type: 'high_delta'
                        } as any);
                        existingAlertControllerIds.add(fc.controller_id);
                        log('DELTA_ALERT', 'pass', `Alert created for ${fc.name}`);
                      }
                    }

                    const baseTempReduction = parseFloat(String(settings.temp_reduction_degrees));
                    const effectiveTempReduction = baseTempReduction * deltaMultiplier;

                    if (deltaMultiplier > 1.0) {
                      log('DELTA_ADJUSTMENT', 'action', `Delta multiplier: ${deltaMultiplier}x (${baseTempReduction}°C → ${effectiveTempReduction.toFixed(1)}°C reduction)`);
                    }

                    const proposedNewTarget = currentCoolerTarget - effectiveTempReduction;
                    const maxAllowedTarget = lowestTargetTemp - parseFloat(String(settings.max_diff_from_lowest));

                    let finalTarget = proposedNewTarget;
                    if (proposedNewTarget < maxAllowedTarget) {
                      finalTarget = maxAllowedTarget;
                      log('TARGET_CALCULATION', 'info', `Limited by max_diff_from_lowest to ${finalTarget.toFixed(1)}°C`);
                    }

                    if (finalTarget < currentCoolerTarget) {
                      const coolerMinTemp = parseFloat(String(coolerController.min_target_temp ?? '-5'));
                      const coolerMaxTemp = parseFloat(String(coolerController.max_target_temp ?? '25'));

                      if (finalTarget < coolerMinTemp) {
                        log('ADJUSTMENT', 'fail', `Cannot set cooler below minimum (${coolerMinTemp}°C)`);
                      } else if (finalTarget > coolerMaxTemp) {
                        log('ADJUSTMENT', 'fail', `Cannot set cooler above maximum (${coolerMaxTemp}°C)`);
                      } else {
                        log('ADJUSTMENT', 'action', `Lowering cooler from ${currentCoolerTarget}°C to ${finalTarget}°C`);

                        const lowerSuccess = await setControllerTargetTemp(supabaseUrl, supabaseKey, coolerController.controller_id, finalTarget);

                        if (lowerSuccess) {
                          log('ADJUSTMENT', 'pass', `Updated cooler to ${finalTarget}°C`);
                          allAdjustments.push({ cooler: coolerController.name, oldTarget: currentCoolerTarget, newTarget: finalTarget });

                          const lowestFollowedTemp = followedControllersFullData
                            .map(c => parseFloat(String(c.current_temp ?? c.pill_temp ?? '999')))
                            .reduce((min, temp) => Math.min(min, temp), 999);

                          await supabase.from('auto_cooling_adjustments').insert({
                            cooler_controller_id: coolerController.controller_id,
                            cooler_controller_name: coolerController.name,
                            old_target_temp: currentCoolerTarget,
                            new_target_temp: finalTarget,
                            lowest_followed_temp: lowestFollowedTemp,
                            followed_controller_id: lowestTempController.controller_id,
                            followed_controller_name: lowestTempController.name,
                            followed_current_temp: parseFloat(String(lowestTempController.current_temp ?? lowestTempController.pill_temp ?? '0')),
                            followed_target_temp: parseFloat(String(lowestTempController.target_temp ?? '0')),
                            followed_hysteresis: parseFloat(String(lowestTempController.cooling_hysteresis ?? '0.2')),
                            reason: `${lowestTempController.name} struggling to cool`
                          } as any);
                        } else {
                          log('ADJUSTMENT', 'fail', 'Failed to update cooler controller');
                        }
                      }
                    } else {
                      log('ADJUSTMENT', 'info', 'Cooler target would not be lowered');
                    }
                  } else {
                    await (supabase as any).from('auto_cooling_settings').update({ last_check_at: new Date().toISOString() }).eq('id', settings.id);
                    // Sustained cooling check failed but controller IS actively cooling
                    // Still check if cooler needs recovery/adjustment toward ideal
                  }
                }
              }
            } else {
              // Not actively cooling - reset timer
              await (supabase as any).from('auto_cooling_settings').update({ last_check_at: null }).eq('id', settings.id);
              log('TIMER', 'info', 'Reset timer - not actively cooling');
            }

            // Always check recovery: move cooler toward ideal target regardless of active cooling state
            {
              const idealTarget = lowestTargetTemp - parseFloat(String(settings.temp_reduction_degrees));
              const coolerMinTemp = parseFloat(String(coolerController.min_target_temp ?? '-5'));
              const coolerMaxTemp = parseFloat(String(coolerController.max_target_temp ?? '25'));

              const needsLowering = currentCoolerTarget > idealTarget + 0.2;
              const needsRaising = currentCoolerTarget < idealTarget - 0.2;

              log('COOLING_RECOVERY_CHECK', 'info', `Recovery check: cooler=${currentCoolerTarget}°C, ideal=${idealTarget.toFixed(1)}°C, needs_lowering=${needsLowering}, needs_raising=${needsRaising}`);

              if (needsLowering || needsRaising) {
                try {
                // Check interval guard: don't adjust more often than every 30 minutes
                const RECOVERY_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
                const { data: lastRecovery, error: recoveryQueryError } = await supabase
                  .from('auto_cooling_adjustments')
                  .select('created_at')
                  .like('reason', '%Cooling recovery%')
                  .order('created_at', { ascending: false })
                  .limit(1);

                if (recoveryQueryError) {
                  log('COOLING_RECOVERY', 'fail', `Query error: ${recoveryQueryError.message}`);
                }

                const lastRecoveryTime = lastRecovery?.[0]?.created_at ? new Date(lastRecovery[0].created_at).getTime() : 0;
                const timeSinceLastRecovery = Date.now() - lastRecoveryTime;

                log('COOLING_RECOVERY_INTERVAL', 'info', `Last recovery: ${lastRecoveryTime === 0 ? 'never' : `${Math.round(timeSinceLastRecovery / 60000)}min ago`}, need ${RECOVERY_INTERVAL_MS / 60000}min`);

                if (timeSinceLastRecovery < RECOVERY_INTERVAL_MS) {
                  log('COOLING_RECOVERY', 'info', `Skipping recovery - only ${Math.round(timeSinceLastRecovery / 60000)}min since last (need ${RECOVERY_INTERVAL_MS / 60000}min)`);
                } else {
                  // Set directly to ideal — glycol cooler doesn't need ramping
                  let recoveryTarget = Math.round(idealTarget * 10) / 10;
                  recoveryTarget = Math.max(coolerMinTemp, Math.min(coolerMaxTemp, recoveryTarget));

                  const significantChange = needsLowering
                    ? recoveryTarget <= currentCoolerTarget - 0.1
                    : recoveryTarget >= currentCoolerTarget + 0.1;

                  if (significantChange) {
                    const direction = needsLowering ? 'Sänker' : 'Höjer';
                    log('COOLING_RECOVERY', 'action', `${direction} cooler from ${currentCoolerTarget}°C toward ideal ${idealTarget.toFixed(1)}°C → ${recoveryTarget}°C`);

                    const coolRecSuccess = await setControllerTargetTemp(supabaseUrl, supabaseKey, coolerController.controller_id, recoveryTarget);

                    if (coolRecSuccess) {
                      log('COOLING_RECOVERY', 'pass', `Set cooler to ${recoveryTarget}°C`);
                      allAdjustments.push({ cooler: coolerController.name, oldTarget: currentCoolerTarget, newTarget: recoveryTarget });

                      await supabase.from('auto_cooling_adjustments').insert({
                        cooler_controller_id: coolerController.controller_id,
                        cooler_controller_name: coolerController.name,
                        old_target_temp: currentCoolerTarget,
                        new_target_temp: recoveryTarget,
                        lowest_followed_temp: lowestTargetTemp,
                        followed_controller_id: lowestTempController.controller_id,
                        followed_controller_name: lowestTempController.name,
                        followed_current_temp: lowestCurrentTemp,
                        followed_target_temp: lowestTargetTemp,
                        reason: `🔄 Cooling recovery: ${needsLowering ? 'kylbehov ökat' : 'kylbehov minskat'}, ${needsLowering ? 'sänker' : 'höjer'} mot ideal ${idealTarget.toFixed(1)}°C`
                      } as any);
                    } else {
                      log('COOLING_RECOVERY', 'fail', `Failed to update cooler`);
                    }
                  }
                }
                } catch (recoveryError) {
                  log('COOLING_RECOVERY', 'fail', `Recovery error: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`);
                }
              }
            }
          }
        }
      }
    } else {
      log('COOLING', 'info', 'Auto cooling adjustment disabled');
    }

    log('COMPLETE', 'info', `Completed`, { adjustments_made: allAdjustments.length });
    await printSummary(supabase, allAdjustments.length > 0 ? 'Adjustment made' : 'No adjustment needed', allAdjustments.length > 0);

    return new Response(JSON.stringify({ success: true, adjustments: allAdjustments, message: `Made ${allAdjustments.length} adjustments`, decisionLog }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    log('ERROR', 'fail', 'Unexpected error', { error: error instanceof Error ? error.message : 'Unknown error' });
    await printSummary(supabase, 'Error', false);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error', decisionLog }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
