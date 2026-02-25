import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { round1, TempController, setControllerTargetTemp, loadPillCompSettings, calculateCompensatedTarget, learnGlycolCoolerRate, getGlycolRatesSummary } from '../_shared/temp-utils.ts';
import { insertNotification } from '../_shared/notifications.ts';

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

// Temperature bucket for context-aware learning
function getTempBucket(targetTemp: number): string {
  if (targetTemp < 8) return 'cold';      // Cold crash / lagering
  if (targetTemp < 14) return 'cool';     // Lager fermentation
  if (targetTemp < 20) return 'warm';     // Ale fermentation
  return 'hot';                           // Saison / high-temp
}

// Load a learned parameter, returning the learned value or a default
async function getLearnedParam(
  supabase: ReturnType<typeof createClient>,
  controllerId: string,
  paramName: string,
  defaultValue: number
): Promise<{ value: number; sampleCount: number }> {
  const { data } = await supabase
    .from('fermentation_learnings')
    .select('learned_value, sample_count')
    .eq('controller_id', controllerId)
    .eq('parameter_name', paramName)
    .maybeSingle();
  return {
    value: data ? parseFloat(String(data.learned_value)) : defaultValue,
    sampleCount: data?.sample_count ?? 0,
  };
}

// Update a learned parameter with EMA (exponential moving average)
async function updateLearnedParam(
  supabase: ReturnType<typeof createClient>,
  controllerId: string,
  paramName: string,
  newObservation: number,
  clampMin: number,
  clampMax: number
) {
  const { data: existing } = await supabase
    .from('fermentation_learnings')
    .select('learned_value, sample_count')
    .eq('controller_id', controllerId)
    .eq('parameter_name', paramName)
    .maybeSingle();

  const sampleCount = existing?.sample_count ?? 0;
  const alpha = sampleCount < 5 ? 0.5 : 0.2; // Learn faster initially
  const currentValue = existing ? parseFloat(String(existing.learned_value)) : newObservation;
  const newValue = Math.max(clampMin, Math.min(clampMax, currentValue * (1 - alpha) + newObservation * alpha));

  await supabase.from('fermentation_learnings').upsert({
    controller_id: controllerId,
    parameter_name: paramName,
    learned_value: Math.round(newValue * 100) / 100,
    sample_count: sampleCount + 1,
    last_updated_at: new Date().toISOString(),
  }, { onConflict: 'controller_id,parameter_name' });

  return { oldValue: currentValue, newValue, sampleCount: sampleCount + 1 };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const decisionLog: DecisionLogEntry[] = [];
  const startTime = Date.now();

  // No mode parsing needed — all features run in a single pass
  try { await req.json(); } catch { /* no body */ }

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

    // Always persist decision log
    if (supabase) {
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

    // Load pill-comp settings early — needed to check feature toggles
    const pillCompSettings = await loadPillCompSettings(supabase);

    // Check if ANY feature is enabled
    const coolingEnabled = settings.enabled;
    const pillCompEnabled = pillCompSettings.enabled;

    log('SETTINGS', 'info', 'Feature toggles', {
      cooling: coolingEnabled,
      pill_compensation: pillCompEnabled,
    });

    if (!coolingEnabled && !pillCompEnabled) {
      log('SETTINGS', 'fail', 'All features disabled');
      await printSummary(supabase, 'All disabled', false);
      return new Response(JSON.stringify({ message: 'All features disabled', decisionLog }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Auto-detect: fetch ALL controllers, then filter for followed and cooler
    const { data: allControllersData, error: allControllersError } = await supabase
      .from('rapt_temp_controllers')
      .select('*');

    const allControllers = (allControllersData || []) as TempController[];

    if (allControllersError || allControllers.length === 0) {
      log('CONTROLLERS', 'fail', 'No controllers found');
      await printSummary(supabase, 'No controllers', false);
      return new Response(JSON.stringify({ message: 'No controllers', decisionLog }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Auto-follow: all controllers with active cooling or heating, excluding the glycol cooler
    const followedControllersFullData = allControllers.filter(c => 
      !(c as any).is_glycol_cooler && (c.cooling_enabled || c.heating_enabled)
    ) as TempController[];

    const followedControllerIds = followedControllersFullData.map(c => c.controller_id);

    if (followedControllerIds.length === 0) {
      log('FOLLOWED_CONTROLLERS', 'info', 'No controllers with active cooling or heating found (glycol cooler may still run)');
    } else {
      log('FOLLOWED_CONTROLLERS', 'pass', `Auto-detected ${followedControllerIds.length} active controller(s)`);
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
    // Map controller_id → brew_id from running fermentation session
    const sessionBrewIdMap = new Map<string, string>();
    // Check for 30-min cooloff after fermentation profile adjustments
    const cooloffControllerIds = new Set<string>();
    // Collect profile status per controller for consolidated logging
    const profileStatusMap = new Map<string, { profileTarget: number | null; stepIndex: number; hasCooloff: boolean; activeTarget?: number | null }>();
    // Always fetch profile data (needed for correct original_target in all modes)
    {
      const { data: runningSessions } = await supabase
        .from('fermentation_sessions')
        .select('id, controller_id, profile_id, current_step_index, step_started_at, step_start_temp, brew_id')
        .eq('status', 'running')
        .in('controller_id', followedControllerIds);

      if (runningSessions && runningSessions.length > 0) {
        // Pre-check cooloff for all sessions if needed
        const cooloffSet = new Set<string>();
        {
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
          if (session.brew_id) {
            sessionBrewIdMap.set(session.controller_id, session.brew_id);
          }
          
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

    // pillCompSettings already loaded above (needed for feature toggle check)

    const allAdjustments: Array<{ cooler: string; oldTarget: number; newTarget: number }> = [];

    // ====================================================================
    // FEATURE 1: PILL COMPENSATION (PID-based temperature control)
    // Handles both undershoot and overshoot via symmetric PI-regulator.
    // ====================================================================
    if (pillCompSettings.enabled) {
      log('PILL_COMP', 'info', '--- PID pill compensation check ---');

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
        // Profile-owned controllers: use profile_target_temp as the base target
        // (PID is the sole owner of setControllerTargetTemp)
        const isProfileOwned = profileOwnedControllerIds.has(fc.controller_id);

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
        // Profile-owned: use profile_target_temp (set by process-fermentation-profiles)
        // Standalone: use original target from historical adjustments
        let baseTarget: number;
        if (isProfileOwned) {
          const profileTarget = (fc as any).profile_target_temp;
          if (profileTarget === null || profileTarget === undefined) {
            log('PILL_COMP_SKIP', 'info', `${fc.name}: profile-owned but no profile_target_temp set yet`);
            continue;
          }
          baseTarget = parseFloat(String(profileTarget));
        } else {
          baseTarget = pillCompOriginalTargetMap.get(fc.controller_id) ?? targetTemp;
        }

        // Determine mode based on actual temperature vs target (not just enabled flags)
        // Both heating and cooling can be enabled simultaneously on RAPT controllers
        const actualTemp = fc.pill_temp ?? fc.current_temp ?? targetTemp;
        const pidMode: 'heating' | 'cooling' = actualTemp < baseTarget ? 'heating' : 'cooling';
        const stepType = isProfileOwned ? (profileStatusMap.get(fc.controller_id) ? 'profile' : 'unknown') : 'standalone';

        const compensation = await calculateCompensatedTarget(
          supabase, fc.controller_id, baseTarget, targetTemp,
          fc.name || fc.controller_id, pillCompSettings, pidMode, stepType
        );

        if (!compensation) {
          // For profile-owned controllers without pill compensation,
          // still enforce the profile target directly
          if (isProfileOwned) {
            const diff = Math.abs(targetTemp - baseTarget);
            if (diff >= 0.15) {
              log('PROFILE_ENFORCE', 'action', `${fc.name}: enforcing profile target ${baseTarget}°C (current controller=${targetTemp}°C, no pill-comp needed)`);
              const success = await setControllerTargetTemp(supabaseUrl, supabaseKey, fc.controller_id, baseTarget);
              if (success) {
                allAdjustments.push({ cooler: fc.name, oldTarget: targetTemp, newTarget: baseTarget });
                await supabase.from('rapt_temp_controllers')
                  .update({ target_temp: baseTarget, updated_at: new Date().toISOString() })
                  .eq('controller_id', fc.controller_id);
                
                await supabase.from('auto_cooling_adjustments').insert({
                  cooler_controller_id: fc.controller_id,
                  cooler_controller_name: fc.name,
                  old_target_temp: targetTemp,
                  new_target_temp: baseTarget,
                  original_target_temp: baseTarget,
                  lowest_followed_temp: baseTarget,
                  followed_current_temp: parseFloat(String(fc.pill_temp ?? fc.current_temp ?? '0')),
                  followed_target_temp: parseFloat(String(fc.current_temp ?? '0')),
                  reason: `🔧 Profil-enforce: ${baseTarget.toFixed(1)}°C (ingen pill-komp behövs)`,
                  adjusted_against_timestamp: fc.last_update,
                } as any);
              }
            }
          }
          continue;
        }

        // Safety bounds
        const maxTemp = parseFloat(String(fc.max_target_temp ?? '25'));
        const minTemp = parseFloat(String(fc.min_target_temp ?? '-5'));
        let newTarget = Math.max(minTemp, Math.min(maxTemp, compensation.compensatedTarget));

        if (Math.abs(newTarget - targetTemp) < 0.1) {
          continue;
        }

        const learnedInfo = compensation.learnedBaseline > 0 ? `, learned=${compensation.learnedBaseline.toFixed(2)}[${compensation.deltaBucket}]n=${compensation.convergenceCount}` : ''
        const piTermInfo = compensation.errorCorrection !== 0 ? `, PI=${compensation.errorCorrection >= 0 ? '+' : ''}${compensation.errorCorrection.toFixed(2)}°C(P=${compensation.pCorrection?.toFixed(2) ?? '0'},I=${compensation.iCorrection?.toFixed(2) ?? '0'}${learnedInfo})` : ''
        const dTermInfo = compensation.dampingFactor < 1.0
          ? `, D-term: rate=${compensation.pillRate?.toFixed(2) ?? '?'}°/h, ETA=${compensation.etaMinutes ?? '?'}min, damp=${compensation.dampingFactor.toFixed(2)}${piTermInfo}`
          : `, D-term: rate=${compensation.pillRate?.toFixed(2) ?? '?'}°/h, damp=1.0${piTermInfo}`

        log('PILL_COMP_ACTION', 'action', `${fc.name}: PID ${baseTarget.toFixed(1)}°C → ${newTarget.toFixed(1)}°C (delta=${compensation.avgDelta.toFixed(2)}, komp=${compensation.compensation.toFixed(2)}°C${dTermInfo})`);

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
            reason: `🎯 Pill-kompensation: ${baseTarget.toFixed(1)}°C → ${newTarget.toFixed(1)}°C (delta=${compensation.avgDelta.toFixed(2)}, komp=${compensation.compensation.toFixed(2)}°C${dTermInfo})`,
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
    // FEATURE 2: STALL DETECTION (adaptive learning from SG outcomes)
    // Detects fermentation stalls and auto-boosts temperature.
    // Learns optimal boost size from outcomes of previous boosts.
    // ====================================================================
    const stallSettings = {
      enabled: (settings as any).auto_boost_enabled ?? false,
      sgRateThreshold: parseFloat(String((settings as any).stall_rate_threshold ?? 0.001)),
      minAttenuation: parseFloat(String((settings as any).stall_min_attenuation ?? 10)),
      maxAttenuation: parseFloat(String((settings as any).stall_max_attenuation ?? 90)),
    };

    if (stallSettings.enabled) {
      // === STEP 2a: Evaluate pending boost outcomes (learn from past boosts) ===
      {
        const { data: pendingOutcomes } = await supabase
          .from('stall_boost_outcomes')
          .select('id, controller_id, brew_id, boost_degrees, sg_rate_before, created_at')
          .eq('outcome', 'pending')
          .lt('created_at', new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString());

        if (pendingOutcomes && pendingOutcomes.length > 0) {
          for (const outcome of pendingOutcomes) {
            // Get current SG rate for this brew
            let sgRateAfter: number | null = null;
            if (outcome.brew_id) {
              const { data: brew } = await supabase
                .from('brew_readings')
                .select('sg_data')
                .eq('id', outcome.brew_id)
                .maybeSingle();

              if (brew?.sg_data) {
                const sgData = (Array.isArray(brew.sg_data) ? brew.sg_data : []) as Array<{ date: string; value: number }>;
                const sortedSg = [...sgData].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                const boostTime = new Date(outcome.created_at).getTime();
                // Get SG data from 12-24h after boost
                const postBoostSg = sortedSg.filter(p => {
                  const t = new Date(p.date).getTime();
                  return t > boostTime + 6 * 60 * 60 * 1000 && t < boostTime + 24 * 60 * 60 * 1000;
                });
                if (postBoostSg.length >= 2) {
                  const newest = postBoostSg[0];
                  const oldest = postBoostSg[postBoostSg.length - 1];
                  const hours = (new Date(newest.date).getTime() - new Date(oldest.date).getTime()) / (1000 * 60 * 60);
                  if (hours > 3) {
                    sgRateAfter = ((oldest.value - newest.value) / hours) * 24;
                  }
                }
              }
            }

            const isEffective = sgRateAfter !== null && sgRateAfter > stallSettings.sgRateThreshold;
            await supabase.from('stall_boost_outcomes').update({
              sg_rate_after: sgRateAfter,
              outcome: sgRateAfter !== null ? (isEffective ? 'effective' : 'ineffective') : 'no_data',
              evaluated_at: new Date().toISOString(),
            }).eq('id', outcome.id);

            // Update learned boost degrees based on outcome
            // AGGRESSIVE LEARNING: If ineffective, double the boost next time.
            // If effective, lock in the successful size (with slight EMA smoothing).
            if (sgRateAfter !== null) {
              const { data: learned } = await supabase
                .from('fermentation_learnings')
                .select('learned_value, sample_count')
                .eq('controller_id', outcome.controller_id)
                .eq('parameter_name', 'stall_boost_degrees')
                .maybeSingle();

              const currentLearned = learned?.learned_value ?? 1.0;
              const sampleCount = learned?.sample_count ?? 0;
              const boostUsed = parseFloat(String(outcome.boost_degrees));
              let newValue = currentLearned;

              if (!isEffective) {
                // Ineffective — aggressively increase: double the boost that failed
                // If 2°C didn't work, try 4°C next time
                newValue = Math.min(6.0, boostUsed * 2);
                log('STALL_LEARN', 'action', `Boost ${boostUsed.toFixed(1)}°C ineffektiv → dubblerar till ${newValue.toFixed(1)}°C`);
              } else if (sgRateAfter > stallSettings.sgRateThreshold * 3) {
                // Very effective — the boost was more than needed, try reducing by 25%
                newValue = Math.max(0.5, boostUsed * 0.75);
                log('STALL_LEARN', 'info', `Boost ${boostUsed.toFixed(1)}°C väldigt effektiv → minskar till ${newValue.toFixed(1)}°C`);
              } else {
                // Effective but not overkill — lock in this size as the baseline
                // Use EMA to smooth: weight the successful boost heavily
                const alpha = sampleCount < 3 ? 0.8 : 0.5;
                newValue = currentLearned * (1 - alpha) + boostUsed * alpha;
                log('STALL_LEARN', 'info', `Boost ${boostUsed.toFixed(1)}°C effektiv → låser in ${newValue.toFixed(1)}°C`);
              }

              newValue = Math.max(0.5, Math.min(6.0, Math.round(newValue * 10) / 10));

              await supabase.from('fermentation_learnings').upsert({
                controller_id: outcome.controller_id,
                parameter_name: 'stall_boost_degrees',
                learned_value: newValue,
                sample_count: sampleCount + 1,
                last_updated_at: new Date().toISOString(),
              }, { onConflict: 'controller_id,parameter_name' });

              log('STALL_LEARN', 'info', `Utvärderade boost-utfall för ${outcome.controller_id}`, {
                boost_degrees: boostUsed,
                sg_rate_before: outcome.sg_rate_before.toFixed(4),
                sg_rate_after: sgRateAfter.toFixed(4),
                outcome: isEffective ? 'effective' : 'ineffective',
                learned_boost: `${currentLearned.toFixed(1)} → ${newValue.toFixed(1)}°C`,
                samples: sampleCount + 1,
              });
            }
          }
        }
      }

      // === STEP 2b: Detect stalls and apply adaptive boost ===
      log('STALL', 'info', '--- Stall detection check ---');

      for (const session of [...profileOwnedControllerIds].map(cId => ({
        controller_id: cId,
        profileTarget: profileTargetMap.get(cId),
      }))) {
        const fc = followedControllersFullData.find(c => c.controller_id === session.controller_id);
        if (!fc) continue;

        // Get learned boost degrees for this controller (or default 1.0)
        const { data: learnedBoost } = await supabase
          .from('fermentation_learnings')
          .select('learned_value, sample_count')
          .eq('controller_id', fc.controller_id)
          .eq('parameter_name', 'stall_boost_degrees')
          .maybeSingle();

        const boostDeg = learnedBoost?.learned_value ?? 1.0;
        const boostSamples = learnedBoost?.sample_count ?? 0;

        // Need a linked brew to get SG data
        const sessionBrewId = sessionBrewIdMap.get(fc.controller_id);
        let brewLink: any = null;
        if (sessionBrewId) {
          const { data } = await supabase
            .from('brew_readings')
            .select('id, name, sg_data, original_gravity, final_gravity, status')
            .eq('id', sessionBrewId)
            .maybeSingle();
          brewLink = data;
        }
        if (!brewLink) {
          const { data } = await supabase
            .from('brew_readings')
            .select('id, name, sg_data, original_gravity, final_gravity, status')
            .eq('linked_controller_id', fc.controller_id)
            .in('status', ['Fermenting', 'Jäsning'])
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          brewLink = data;
        }

        if (!brewLink) {
          log('STALL_SKIP', 'info', `${fc.name}: Ingen aktiv bryggning kopplad`);
          continue;
        }

        const brewName = (brewLink as any).name ?? brewLink.id;
        const now = Date.now();

        // Fetch pre-computed fermentation metrics instead of manual calculations
        const { data: metrics } = await supabase
          .from('brew_fermentation_metrics')
          .select('activity_score, sg_rate_per_hour, fermentation_phase')
          .eq('brew_id', brewLink.id)
          .maybeSingle();

        if (!metrics) {
          log('STALL_SKIP', 'info', `${fc.name} (${brewName}): Inga förberäknade metrics`);
          continue;
        }

        const sgRatePerHour = parseFloat(String(metrics.sg_rate_per_hour));
        const sgRatePerDay = sgRatePerHour * 24;
        const activityScore = parseFloat(String(metrics.activity_score));
        const phase = metrics.fermentation_phase;

        const sgIsStalling = sgRatePerDay < stallSettings.sgRateThreshold;
        const activityIsLow = activityScore < 20;

        // Check attenuation range (still needs brew OG/FG/current SG)
        const og = parseFloat(String(brewLink.original_gravity ?? 0));
        const fg = parseFloat(String(brewLink.final_gravity ?? 0));
        const sgData = (Array.isArray(brewLink.sg_data) ? brewLink.sg_data : []) as Array<{ date: string; value: number }>;
        const sortedSg = [...sgData].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const currentSg = sortedSg.length > 0 ? sortedSg[0].value : parseFloat(String(brewLink.original_gravity ?? 0));
        const attenuationRange = og - fg;
        const currentAttenuation = attenuationRange > 0 ? ((og - currentSg) / attenuationRange) * 100 : 0;

        if (currentAttenuation < stallSettings.minAttenuation || currentAttenuation > stallSettings.maxAttenuation) {
          log('STALL_SKIP', 'info', `${fc.name} (${brewName}): Utjäsning ${currentAttenuation.toFixed(0)}% utanför intervall ${stallSettings.minAttenuation}-${stallSettings.maxAttenuation}%`);
          continue;
        }

        const stallDetected = sgIsStalling && activityIsLow;
        const ratePct = stallSettings.sgRateThreshold > 0 ? ((sgRatePerDay / stallSettings.sgRateThreshold) * 100).toFixed(0) : '?';

        log('STALL_ANALYSIS', stallDetected ? 'action' : 'info', `${fc.name} (${brewName})`, {
          sg_rate: `${sgRatePerDay.toFixed(4)}/dag (${ratePct}% av tröskel)`,
          sg_stalling: sgIsStalling,
          activity_score: activityScore,
          activity_low: activityIsLow,
          phase,
          stall_detected: stallDetected,
          learned_boost: `${boostDeg.toFixed(1)}°C (${boostSamples} samples)`,
        });

        if (!stallDetected) {
          // === UN-BOOST: If fermentation resumed, reverse active boost ===
          const { data: recentBoost } = await supabase
            .from('auto_cooling_adjustments')
            .select('created_at, new_target_temp, old_target_temp')
            .eq('cooler_controller_id', fc.controller_id)
            .like('reason', '🔥%')
            .order('created_at', { ascending: false })
            .limit(1);

          if (recentBoost && recentBoost.length > 0) {
            const boostAgeHours = (now - new Date(recentBoost[0].created_at).getTime()) / (1000 * 60 * 60);
            const alreadyReversed = await supabase
              .from('auto_cooling_adjustments')
              .select('id')
              .eq('cooler_controller_id', fc.controller_id)
              .like('reason', '🔄%')
              .gt('created_at', recentBoost[0].created_at)
              .limit(1);

            if (boostAgeHours < 24 && (!alreadyReversed.data || alreadyReversed.data.length === 0)) {
              const { data: existingComp } = await supabase
                .from('controller_learned_compensation')
                .select('id, learned_pi_correction, accumulated_integral')
                .eq('controller_id', fc.controller_id)
                .eq('delta_bucket', 'active')
                .eq('mode', fc.cooling_enabled ? 'cooling' : 'heating')
                .limit(1)
                .maybeSingle();

              if (existingComp) {
                const newCorrection = Math.max(0, existingComp.learned_pi_correction - boostDeg);
                const newIntegral = Math.max(0, existingComp.accumulated_integral - boostDeg);
                await supabase.from('controller_learned_compensation')
                  .update({
                    learned_pi_correction: newCorrection,
                    accumulated_integral: newIntegral,
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', existingComp.id);

                log('STALL_UNBOOST', 'action', `${fc.name} (${brewName}): Jäsning återupptagits, PID -${boostDeg.toFixed(1)}°C`);

                const currentTarget = parseFloat(String(fc.target_temp ?? 20));
                const profileTarget = session.profileTarget ?? currentTarget;
                await supabase.from('auto_cooling_adjustments').insert({
                  cooler_controller_id: fc.controller_id,
                  cooler_controller_name: fc.name,
                  old_target_temp: currentTarget,
                  new_target_temp: currentTarget,
                  original_target_temp: profileTarget,
                  lowest_followed_temp: currentTarget,
                  followed_controller_id: fc.controller_id,
                  followed_controller_name: fc.name,
                  followed_current_temp: parseFloat(String(fc.pill_temp ?? fc.current_temp ?? 0)),
                  followed_target_temp: profileTarget,
                  reason: `🔄 Un-boost: aktivitet ${activityScore}%, fas ${phase}, PID -${boostDeg.toFixed(1)}°C`,
                } as any);
              }
            }
          }
          continue;
        }

        // Cooldown: don't boost same controller within 6 hours
        const { data: lastBoost } = await supabase
          .from('auto_cooling_adjustments')
          .select('created_at')
          .eq('cooler_controller_id', fc.controller_id)
          .like('reason', '🔥%')
          .order('created_at', { ascending: false })
          .limit(1);

        if (lastBoost && lastBoost.length > 0) {
          const hoursSinceBoost = (now - new Date(lastBoost[0].created_at).getTime()) / (1000 * 60 * 60);
          if (hoursSinceBoost < 6) {
            log('STALL_COOLDOWN', 'info', `${fc.name}: Senaste boost var ${hoursSinceBoost.toFixed(1)}h sedan (väntar 6h)`);
            continue;
          }
        }

        // Apply adaptive boost
        const currentTarget = parseFloat(String(fc.target_temp ?? 20));
        const profileTarget = session.profileTarget ?? currentTarget;
        const maxTemp = parseFloat(String(fc.max_target_temp ?? 25));
        const boostedTarget = currentTarget + boostDeg;

        if (boostedTarget > maxTemp) {
          log('STALL_SKIP', 'info', `${fc.name}: Boost blocked by safety bounds (${boostedTarget.toFixed(1)}°C > max=${maxTemp}°C)`);
          continue;
        }

        log('STALL_BOOST', 'action', `${fc.name}: Stall! Adaptiv boost +${boostDeg.toFixed(1)}°C (lärd från ${boostSamples} tidigare boosts)`);

        const { data: existingComp } = await supabase
          .from('controller_learned_compensation')
          .select('id, learned_pi_correction, accumulated_integral')
          .eq('controller_id', fc.controller_id)
          .eq('delta_bucket', 'active')
          .eq('mode', fc.cooling_enabled ? 'cooling' : 'heating')
          .limit(1)
          .maybeSingle();

        if (existingComp) {
          const newCorrection = existingComp.learned_pi_correction + boostDeg;
          await supabase.from('controller_learned_compensation')
            .update({
              learned_pi_correction: newCorrection,
              accumulated_integral: existingComp.accumulated_integral + boostDeg,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingComp.id);
          log('STALL_BOOST', 'pass', `${fc.name}: PID +${boostDeg.toFixed(1)}°C (total: ${newCorrection.toFixed(2)}°C)`);
        } else {
          const safeTarget = Math.min(maxTemp, boostedTarget);
          const boostSuccess = await setControllerTargetTemp(supabaseUrl, supabaseKey, fc.controller_id, safeTarget);
          if (boostSuccess) {
            await supabase.from('rapt_temp_controllers')
              .update({ target_temp: safeTarget, updated_at: new Date().toISOString() })
              .eq('controller_id', fc.controller_id);
            log('STALL_BOOST', 'pass', `${fc.name}: Direkt boost ${currentTarget}°C → ${safeTarget}°C`);
          } else {
            log('STALL_BOOST', 'fail', `${fc.name}: Kunde inte höja temperaturen`);
            continue;
          }
        }

        allAdjustments.push({ cooler: fc.name, oldTarget: currentTarget, newTarget: boostedTarget });

        // Record outcome for learning (will be evaluated in 12h)
        await supabase.from('stall_boost_outcomes').insert({
          controller_id: fc.controller_id,
          brew_id: brewLink.id,
          boost_degrees: boostDeg,
          sg_rate_before: sgRatePerDay,
          outcome: 'pending',
        });

        // Notification for stall boost
        await insertNotification(supabase, {
          type: 'stall_boost',
          title: 'Stall detekterad',
          body: `${fc.name} (${brewName}): +${boostDeg.toFixed(1)}°C boost, aktivitet ${activityScore}%, SG-rate ${sgRatePerDay.toFixed(4)}/dag`,
          brew_id: brewLink.id,
          controller_id: fc.controller_id,
        });

        await supabase.from('auto_cooling_adjustments').insert({
          cooler_controller_id: fc.controller_id,
          cooler_controller_name: fc.name,
          old_target_temp: currentTarget,
          new_target_temp: Math.min(maxTemp, boostedTarget),
          original_target_temp: profileTarget,
          lowest_followed_temp: currentTarget,
          followed_controller_id: fc.controller_id,
          followed_controller_name: fc.name,
          followed_current_temp: parseFloat(String(fc.pill_temp ?? fc.current_temp ?? 0)),
          followed_target_temp: profileTarget,
          reason: `🔥 Stall: aktivitet ${activityScore}%, fas ${phase}, SG-rate ${sgRatePerDay.toFixed(4)}/dag, boost +${boostDeg.toFixed(1)}°C (lärd n=${boostSamples})`,
        } as any);

        // Log in fermentation step log
        const { data: activeSession } = await supabase
          .from('fermentation_sessions')
          .select('id, current_step_index')
          .eq('controller_id', fc.controller_id)
          .eq('status', 'running')
          .limit(1)
          .maybeSingle();

        if (activeSession) {
          await supabase.from('fermentation_step_log').insert({
            session_id: activeSession.id,
            step_index: activeSession.current_step_index,
            action: 'stall_boost',
            details: {
              boost_degrees: boostDeg,
              learned_samples: boostSamples,
              via: existingComp ? 'pid_compensation' : 'direct',
              sg_rate_per_day: sgRatePerDay,
              current_sg: currentSg,
              profile_target: profileTarget,
              delta_current: currentAvgDelta,
              delta_is_low: deltaIsLow,
            },
          });
        }
      }
    } else {
      log('STALL', 'info', 'Stall detection disabled');
    }

    // ====================================================================
    // FEATURE 3: AUTO COOLING ADJUSTMENT (runs last)
    // ====================================================================
    if (coolingEnabled) {
      log('COOLING', 'info', '--- Auto cooling adjustment check ---');

      // === OUTCOME EVALUATION: Learn from past cooling adjustments ===
      {
        const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        
        // Find adjustments made 30min-2h ago that haven't been evaluated yet
        const { data: pastAdjustments } = await supabase
          .from('auto_cooling_adjustments')
          .select('id, cooler_controller_id, new_target_temp, followed_controller_id, followed_current_temp, followed_target_temp, reason')
          .like('reason', '%struggling to cool%')
          .lt('created_at', thirtyMinAgo)
          .gt('created_at', twoHoursAgo);

        if (pastAdjustments && pastAdjustments.length > 0) {
          for (const adj of pastAdjustments) {
            if (!adj.followed_controller_id || !adj.followed_target_temp) continue;

            // Check current state of the followed controller
            const fc = followedControllersFullData.find(c => c.controller_id === adj.followed_controller_id);
            if (!fc) continue;

            const currentTemp = parseFloat(String(fc.current_temp ?? fc.pill_temp ?? 999));
            const targetTemp = parseFloat(String(fc.target_temp ?? adj.followed_target_temp));
            const tempBucket = getTempBucket(targetTemp);
            const hysteresis = parseFloat(String(fc.cooling_hysteresis ?? 0.2));

            const reachedTarget = currentTemp <= targetTemp + hysteresis;
            const overshot = currentTemp < targetTemp - 1.0; // Cooled too much

            if (reachedTarget && !overshot) {
              // Perfect — current margin works, slightly reduce it for efficiency
              const currentMargin = targetTemp - adj.new_target_temp;
              const result = await updateLearnedParam(supabase!, adj.cooler_controller_id, `cooler_margin:${tempBucket}`, currentMargin, 2.0, 15.0);
              log('COOLING_LEARN', 'pass', `[${tempBucket}] Margin adequate: ${result.oldValue.toFixed(1)}→${result.newValue.toFixed(1)}°C (n=${result.sampleCount})`);
            } else if (overshot) {
              // Margin was too large — learn a smaller value
              const currentMargin = targetTemp - adj.new_target_temp;
              const reducedMargin = currentMargin * 0.75; // Reduce by 25%
              const result = await updateLearnedParam(supabase!, adj.cooler_controller_id, `cooler_margin:${tempBucket}`, reducedMargin, 2.0, 15.0);
              log('COOLING_LEARN', 'action', `[${tempBucket}] Overshoot! Reducing margin: ${result.oldValue.toFixed(1)}→${result.newValue.toFixed(1)}°C (n=${result.sampleCount})`);
            } else {
              // Still too warm — margin was too small, learn a larger value
              const currentMargin = targetTemp - adj.new_target_temp;
              const increasedMargin = currentMargin * 1.25; // Increase by 25%
              const result = await updateLearnedParam(supabase!, adj.cooler_controller_id, `cooler_margin:${tempBucket}`, increasedMargin, 2.0, 15.0);
              log('COOLING_LEARN', 'action', `[${tempBucket}] Insufficient cooling! Increasing margin: ${result.oldValue.toFixed(1)}→${result.newValue.toFixed(1)}°C (n=${result.sampleCount})`);
            }
          }
        }
      }

      // Find glycol cooler by is_glycol_cooler flag (set under Enheter)
      const coolerFromFlag = allControllers.find(c => (c as any).is_glycol_cooler) as TempController | undefined;

      if (!coolerFromFlag) {
        log('COOLER_CONFIG', 'fail', 'No controller marked as glycol cooler (set under Enheter)');
      } else {
        const coolerController = coolerFromFlag;

        if (!coolerController.cooling_enabled) {
          log('COOLER_STATUS', 'fail', 'Glycol cooler has cooling disabled');
        } else {
          log('COOLER_STATUS', 'pass', `Cooler: ${coolerController.name}`, {
            target_temp: round1(coolerController.target_temp),
            current_temp: round1(coolerController.current_temp)
          });

          const currentCoolerTarget = parseFloat(String(coolerController.target_temp ?? '18'));

          // Learn glycol cooler rate based on current cooling load
          const coolingLoadCount = followedControllersFullData.filter(c => {
            if (!c.cooling_enabled) return false;
            const ct = parseFloat(String(c.current_temp ?? c.pill_temp ?? '0'));
            const tt = parseFloat(String(c.target_temp ?? '999'));
            const hyst = parseFloat(String(c.cooling_hysteresis ?? '0.2'));
            return ct > (tt + hyst); // actually demanding cooling
          }).length;

          const glycolRate = await learnGlycolCoolerRate(supabase!, coolerController.controller_id, coolingLoadCount);
          const allGlycolRates = await getGlycolRatesSummary(supabase!, coolerController.controller_id);

          if (glycolRate || Object.keys(allGlycolRates).length > 0) {
            const rateDetails: Record<string, unknown> = { current_load: coolingLoadCount };
            if (glycolRate) rateDetails.current_rate = `${glycolRate.rate.toFixed(2)}°C/h (n=${glycolRate.sampleCount})`;
            for (const [bucket, info] of Object.entries(allGlycolRates)) {
              rateDetails[`rate_${bucket}`] = `${info.rate.toFixed(2)}°C/h (n=${info.sampleCount})`;
            }
            log('GLYCOL_RATES', 'info', `Learned cooling rates by load`, rateDetails);
          }

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
              const checkIntervalMs = 30 * 60 * 1000; // 30 min auto-learned default

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
                const checkTime = new Date(Date.now() - 30 * 60 * 1000); // 30 min default

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
                    // === SMART CHECK: Is the cooler actually underperforming, or just needs more time? ===
                    // Measure actual cooler cooling rate over the last 30 minutes
                    let skipReduction = false;
                    if (glycolRate && glycolRate.sampleCount >= 3) {
                      // Measure actual glycol temp change over the history window
                      const { data: coolerHistory } = await supabase
                        .from('temp_controller_history')
                        .select('current_temp, recorded_at')
                        .eq('controller_id', coolerController.controller_id)
                        .gte('recorded_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
                        .order('recorded_at', { ascending: true })
                        .limit(50);

                      if (coolerHistory && coolerHistory.length >= 3) {
                        const oldest = coolerHistory[0];
                        const newest = coolerHistory[coolerHistory.length - 1];
                        const tempChange = parseFloat(String(newest.current_temp)) - parseFloat(String(oldest.current_temp));
                        const timeDiffHours = (new Date(newest.recorded_at).getTime() - new Date(oldest.recorded_at).getTime()) / (1000 * 60 * 60);

                        if (timeDiffHours > 0.1) {
                          const actualRate = Math.abs(tempChange) / timeDiffHours; // °C/h (absolute)
                          const isCoolingDown = tempChange < 0;
                          const expectedRate = glycolRate.rate;
                          // If the cooler is actually cooling and at ≥60% of expected rate, it's working fine
                          const performanceRatio = isCoolingDown ? actualRate / expectedRate : 0;

                          log('GLYCOL_PERFORMANCE', 'info', `Cooler performance check`, {
                            actual_rate: `${(isCoolingDown ? '-' : '+')}${actualRate.toFixed(2)}°C/h`,
                            expected_rate: `${expectedRate.toFixed(2)}°C/h`,
                            performance: `${(performanceRatio * 100).toFixed(0)}%`,
                            load: coolingLoadCount,
                          });

                          if (isCoolingDown && performanceRatio >= 0.6) {
                            // Cooler IS cooling at a reasonable pace — the tank just needs more time
                            // Calculate ETA to reach the lowest tank's target
                            const coolerTemp = parseFloat(String(coolerController.current_temp ?? '0'));
                            const etaHours = actualRate > 0.1 ? Math.abs(lowestCurrentTemp - lowestTargetTemp) / (actualRate * 0.3) : 99;
                            const etaMinutes = Math.round(etaHours * 60);

                            log('GLYCOL_PERFORMANCE', 'pass', `Cooler performing at ${(performanceRatio * 100).toFixed(0)}% of expected — tank needs ~${etaMinutes}min more, skipping reduction`, {
                              cooler_temp: `${coolerTemp.toFixed(1)}°C`,
                              tank_temp: `${lowestCurrentTemp.toFixed(1)}°C → ${lowestTargetTemp.toFixed(1)}°C`,
                              eta_minutes: etaMinutes,
                            });
                            skipReduction = true;
                          } else if (!isCoolingDown) {
                            log('GLYCOL_PERFORMANCE', 'fail', `Cooler temp is RISING (${tempChange.toFixed(2)}°C) despite cooling demand — needs lower target`);
                          } else {
                            log('GLYCOL_PERFORMANCE', 'info', `Cooler underperforming (${(performanceRatio * 100).toFixed(0)}% of expected) — proceeding with reduction`);
                          }
                        }
                      }
                    }

                    if (skipReduction) {
                      await (supabase as any).from('auto_cooling_settings').update({ last_check_at: new Date().toISOString() }).eq('id', settings.id);

                      // Glycol is performing normally but tank STILL can't cool fast enough
                      // → The margin (delta) between glycol target and tank target is too small
                      // → Learn to increase it for this temp bucket + load combo
                      const tempBucketLearn = getTempBucket(lowestTargetTemp);
                      const loadBucket = coolingLoadCount >= 2 ? '2plus' : String(coolingLoadCount);
                      const marginParamName = `cooler_margin:${tempBucketLearn}:load_${loadBucket}`;
                      const currentMargin = Math.abs(currentCoolerTarget - lowestTargetTemp);
                      // The tank needs more cooling → suggest a 20% bigger margin
                      const suggestedMargin = currentMargin * 1.2;
                      const marginUpdate = await updateLearnedParam(supabase!, coolerController.controller_id, marginParamName, suggestedMargin, 2.0, 12.0);
                      log('MARGIN_LEARNING', 'action', `Tank slow despite good glycol → learning bigger margin [${tempBucketLearn}/load_${loadBucket}]: ${marginUpdate.oldValue.toFixed(1)}°C → ${marginUpdate.newValue.toFixed(1)}°C (n=${marginUpdate.sampleCount})`, {
                        current_margin: `${currentMargin.toFixed(1)}°C`,
                        suggested: `${suggestedMargin.toFixed(1)}°C`,
                      });

                      // Also update the base margin (without load) so recovery uses a better default
                      const baseMarginUpdate = await updateLearnedParam(supabase!, coolerController.controller_id, `cooler_margin:${tempBucketLearn}`, suggestedMargin, 2.0, 12.0);
                      log('MARGIN_LEARNING', 'info', `Base margin [${tempBucketLearn}]: ${baseMarginUpdate.oldValue.toFixed(1)}°C → ${baseMarginUpdate.newValue.toFixed(1)}°C`);

                      log('DECISION', 'info', `${lowestTempController.name} is cooling — glycol performing normally, keeping current target (learned bigger margin for next time)`);
                    } else {
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

                    }

                    // Context-aware cooler margin: learned per temperature bucket
                    const tempBucket = getTempBucket(lowestTargetTemp);
                    const learnedMargin = await getLearnedParam(supabase!, coolerController.controller_id, `cooler_margin:${tempBucket}`, 5.0);
                    const baseTempReduction = learnedMargin.value;
                    log('LEARNED_MARGIN', 'info', `Cooler margin [${tempBucket}]: ${baseTempReduction.toFixed(1)}°C (${learnedMargin.sampleCount} samples)`);
                    const effectiveTempReduction = baseTempReduction * deltaMultiplier;

                    if (deltaMultiplier > 1.0) {
                      log('DELTA_ADJUSTMENT', 'action', `Delta multiplier: ${deltaMultiplier}x (${baseTempReduction}°C → ${effectiveTempReduction.toFixed(1)}°C reduction)`);
                    }

                    const proposedNewTarget = currentCoolerTarget - effectiveTempReduction;
                    const maxAllowedTarget = lowestTargetTemp - 10.0; // Safety limit

                    let finalTarget = proposedNewTarget;
                    if (proposedNewTarget < maxAllowedTarget) {
                      finalTarget = maxAllowedTarget;
                      log('TARGET_CALCULATION', 'info', `Limited by max_diff_from_lowest to ${finalTarget.toFixed(1)}°C`);
                    }

                    if (finalTarget < currentCoolerTarget) {
                      // Rate-limit: don't adjust cooler more often than every 5 minutes
                      const COOLER_MIN_INTERVAL_MS = 5 * 60 * 1000;
                      const { data: lastAdjust } = await supabase
                        .from('auto_cooling_adjustments')
                        .select('created_at')
                        .eq('cooler_controller_id', coolerController.controller_id)
                        .order('created_at', { ascending: false })
                        .limit(1);
                      const lastAdjustTime = lastAdjust?.[0]?.created_at ? new Date(lastAdjust[0].created_at).getTime() : 0;
                      const timeSinceLastAdjust = Date.now() - lastAdjustTime;

                      if (timeSinceLastAdjust < COOLER_MIN_INTERVAL_MS) {
                        log('ADJUSTMENT', 'info', `Skipping - only ${Math.round(timeSinceLastAdjust / 60000)}min since last adjust (need 5min)`);
                      } else {
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
                      } // end rate-limit else
                    } else {
                      log('ADJUSTMENT', 'info', 'Cooler target would not be lowered');
                    }
                    } // end skipReduction else
                  } else {
                    await (supabase as any).from('auto_cooling_settings').update({ last_check_at: new Date().toISOString() }).eq('id', settings.id);
                    // Sustained cooling check failed but controller IS actively cooling
                    // Still check if cooler needs recovery/adjustment toward ideal
                  }
                }
              }
            } else {
              // Not actively cooling — tank has reached target = margin is adequate or too large
              await (supabase as any).from('auto_cooling_settings').update({ last_check_at: null }).eq('id', settings.id);

              // Learn that the current margin was sufficient (or could be slightly tighter)
              const tempBucketLearn = getTempBucket(lowestTargetTemp);
              const loadBucket = coolingLoadCount >= 2 ? '2plus' : String(coolingLoadCount);
              const currentMargin = Math.abs(currentCoolerTarget - lowestTargetTemp);
              if (currentMargin > 2.0) {
                // Suggest slightly tighter margin (5% reduction) since we have headroom
                const suggestedMargin = currentMargin * 0.95;
                const marginParamName = `cooler_margin:${tempBucketLearn}:load_${loadBucket}`;
                const marginUpdate = await updateLearnedParam(supabase!, coolerController.controller_id, marginParamName, suggestedMargin, 2.0, 12.0);
                const baseUpdate = await updateLearnedParam(supabase!, coolerController.controller_id, `cooler_margin:${tempBucketLearn}`, suggestedMargin, 2.0, 12.0);
                log('MARGIN_LEARNING', 'info', `Tank at target → margin adequate [${tempBucketLearn}/load_${loadBucket}]: ${marginUpdate.oldValue.toFixed(1)}→${marginUpdate.newValue.toFixed(1)}°C (base: ${baseUpdate.oldValue.toFixed(1)}→${baseUpdate.newValue.toFixed(1)}°C)`);
              }

              log('TIMER', 'info', 'Reset timer - not actively cooling');
            }

            // Always check recovery: move cooler toward ideal target regardless of active cooling state
            {
              const tempBucketRecovery = getTempBucket(lowestTargetTemp);
              const loadBucketRecovery = coolingLoadCount >= 2 ? '2plus' : String(coolingLoadCount);
              // Prefer load-specific margin, fall back to base margin
              const loadSpecificMargin = await getLearnedParam(supabase!, coolerController.controller_id, `cooler_margin:${tempBucketRecovery}:load_${loadBucketRecovery}`, 0);
              const baseMargin = await getLearnedParam(supabase!, coolerController.controller_id, `cooler_margin:${tempBucketRecovery}`, 5.0);
              const recoveryMarginValue = loadSpecificMargin.sampleCount >= 3 ? loadSpecificMargin.value : baseMargin.value;
              const idealTarget = lowestTargetTemp - recoveryMarginValue;
              log('RECOVERY_MARGIN', 'info', `Using margin: ${recoveryMarginValue.toFixed(1)}°C (load_${loadBucketRecovery}: ${loadSpecificMargin.value.toFixed(1)}°C n=${loadSpecificMargin.sampleCount}, base: ${baseMargin.value.toFixed(1)}°C n=${baseMargin.sampleCount})`);
              const coolerMinTemp = parseFloat(String(coolerController.min_target_temp ?? '-5'));
              const coolerMaxTemp = parseFloat(String(coolerController.max_target_temp ?? '25'));

              const needsLowering = currentCoolerTarget > idealTarget + 0.2;
              const needsRaising = currentCoolerTarget < idealTarget - 0.2;

              log('COOLING_RECOVERY_CHECK', 'info', `Glykolkylare`, {
                cooler_current: `${currentCoolerTarget}°C`,
                ideal_target: `${idealTarget.toFixed(1)}°C`,
                needs_lowering: needsLowering,
                needs_raising: needsRaising,
              });

              if (needsLowering || needsRaising) {
                try {
                // Check interval guard: don't adjust more often than every 30 minutes
                const RECOVERY_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
                const { data: lastRecovery, error: recoveryQueryError } = await supabase
                  .from('auto_cooling_adjustments')
                  .select('created_at')
                  .eq('cooler_controller_id', coolerController.controller_id)
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
