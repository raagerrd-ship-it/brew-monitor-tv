import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

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

interface TempController {
  controller_id: string;
  name: string;
  current_temp: number | null;
  pill_temp: number | null;
  target_temp: number | null;
  cooling_enabled: boolean | null;
  cooling_hysteresis: number | null;
  min_target_temp: number | null;
  max_target_temp: number | null;
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

    log('START', 'info', 'Starting auto cooling adjustment check', { timestamp: new Date().toISOString() });

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

    // pill_temp is now enriched by sync-rapt-data-quick directly from pill data
    // No need to fetch from brew_readings.sg_data anymore

    // Log each followed controller's status
    followedControllersFullData.forEach(controller => {
      const pillTemp = controller.pill_temp !== null ? parseFloat(String(controller.pill_temp)) : null;
      const currentTemp = parseFloat(String(controller.current_temp ?? controller.pill_temp ?? '0'));
      const targetTemp = parseFloat(String(controller.target_temp ?? '999'));
      const hysteresis = parseFloat(String(controller.cooling_hysteresis ?? '0.2'));
      const isActivelyCooling = controller.cooling_enabled && currentTemp > (targetTemp + hysteresis);
      const pillDelta = pillTemp !== null ? pillTemp - currentTemp : null;
      
      log('FOLLOWED_DATA', 'info', `Controller: ${controller.name}`, {
        target_temp: targetTemp,
        current_temp: currentTemp,
        pill_temp: pillTemp,
        pill_delta: pillDelta !== null ? parseFloat(pillDelta.toFixed(1)) : null,
        cooling_enabled: controller.cooling_enabled,
        is_actively_cooling: isActivelyCooling
      });
    });

    const allAdjustments: Array<{ cooler: string; oldTarget: number; newTarget: number }> = [];

    // ====================================================================
    // FEATURE 1: OVERSHOOT PREVENTION (independent toggle)
    // ====================================================================
    if (overshootEnabled) {
      log('OVERSHOOT', 'info', '--- Overshoot prevention check ---');

      // Cooldown: skip overshoot check if last overshoot adjustment was < 10 minutes ago
      const OVERSHOOT_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
      const { data: lastOvershootAdj } = await supabase
        .from('auto_cooling_adjustments')
        .select('created_at')
        .like('reason', '🌡️%')
        .order('created_at', { ascending: false })
        .limit(1);

      if (lastOvershootAdj && lastOvershootAdj.length > 0) {
        const timeSinceLastAdj = Date.now() - new Date(lastOvershootAdj[0].created_at).getTime();
        if (timeSinceLastAdj < OVERSHOOT_COOLDOWN_MS) {
          const remainingMin = ((OVERSHOOT_COOLDOWN_MS - timeSinceLastAdj) / 60000).toFixed(1);
          log('OVERSHOOT_COOLDOWN', 'info', `Cooldown active: ${remainingMin}min remaining since last overshoot adjustment`);
          // Skip entire overshoot block
        }
      }

      const canRunOvershoot = !lastOvershootAdj || lastOvershootAdj.length === 0 || 
        (Date.now() - new Date(lastOvershootAdj[0].created_at).getTime()) >= OVERSHOOT_COOLDOWN_MS;

      if (!canRunOvershoot) {
        log('OVERSHOOT', 'info', 'Skipping overshoot check due to cooldown');
      }
      
      const overshootPillThreshold = parseFloat(String(settings.overshoot_pill_threshold ?? 0.3));
      const overshootDeltaThreshold = parseFloat(String(settings.overshoot_delta_threshold ?? 2.0));

      for (const fc of followedControllersFullData) {
        if (!canRunOvershoot) break; // Skip all controllers during cooldown
        if (fc.pill_temp === null || fc.pill_temp === undefined || fc.current_temp === null || fc.current_temp === undefined) continue;
        if (fc.target_temp === null || fc.target_temp === undefined) continue;

        const pillTemp = parseFloat(String(fc.pill_temp));
        const ctrlTemp = parseFloat(String(fc.current_temp));
        const targetTemp = parseFloat(String(fc.target_temp));
        const pillDelta = pillTemp - ctrlTemp;

        const pillOverTarget = pillTemp >= targetTemp + overshootPillThreshold;
        const isHeatingOvershoot = pillOverTarget && pillDelta > overshootDeltaThreshold;

        if (isHeatingOvershoot) {
          log('OVERSHOOT_DETECTED', 'action', `Heating overshoot for ${fc.name}: pill=${pillTemp.toFixed(1)}° > target=${targetTemp}°C, ctrl=${ctrlTemp.toFixed(1)}° (delta=${pillDelta.toFixed(1)}°)`);

          const { data: linkedBrews } = await supabase
            .from('brew_readings')
            .select('batch_id, name, current_sg, original_gravity, final_gravity, sg_data, status, style')
            .eq('linked_controller_id', fc.controller_id)
            .in('status', ['Jäser', 'Jäsning', 'Fermenting'])
            .order('last_update', { ascending: false })
            .limit(1);

          const brew = linkedBrews?.[0];
          if (!brew) {
            log('OVERSHOOT_SKIP', 'info', `No linked brew for ${fc.name}, skipping overshoot check`);
            continue;
          }

          const sgData = brew.sg_data as Array<{ date: string; value: number }> | null;
          const sorted = sgData ? [...sgData].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()) : [];
          const sgRange = brew.original_gravity - brew.final_gravity;
          const progressPct = sgRange > 0 ? ((brew.original_gravity - brew.current_sg) / sgRange) * 100 : 100;

          const nowMs = Date.now();
          const last24h = sorted.filter(d => (nowMs - new Date(d.date).getTime()) < 24 * 60 * 60 * 1000);
          let dailyRate = 0;
          if (last24h.length >= 2) {
            const newest = last24h[0].value;
            const oldest = last24h[last24h.length - 1].value;
            const hoursSpan = (new Date(last24h[0].date).getTime() - new Date(last24h[last24h.length - 1].date).getTime()) / (1000 * 60 * 60);
            if (hoursSpan >= 2) dailyRate = Math.abs(oldest - newest) * (24 / hoursSpan);
          }

          const { data: deltaHistoryForAI } = await supabase
            .from('temp_delta_history')
            .select('delta, recorded_at')
            .eq('controller_id', fc.controller_id)
            .order('recorded_at', { ascending: false })
            .limit(10);

          const { data: tempHistory } = await supabase
            .from('temp_controller_history')
            .select('target_temp, recorded_at')
            .eq('controller_id', fc.controller_id)
            .order('recorded_at', { ascending: false })
            .limit(100);

          let hoursAtCurrentTemp = 0;
          if (tempHistory && tempHistory.length > 0) {
            for (const record of tempHistory) {
              if (Math.abs(parseFloat(String(record.target_temp)) - targetTemp) > 0.1) break;
              hoursAtCurrentTemp = (nowMs - new Date(record.recorded_at).getTime()) / (1000 * 60 * 60);
            }
          }

          log('OVERSHOOT_AI', 'info', `Consulting AI for overshoot on ${brew.name}...`);

          try {
            const aiResponse = await supabase.functions.invoke('ai-fermentation-advisor', {
              body: {
                brewName: brew.name,
                beerStyle: brew.style || 'Unknown',
                originalGravity: brew.original_gravity,
                finalGravity: brew.final_gravity,
                currentSG: brew.current_sg,
                currentTemp: ctrlTemp,
                targetTemp,
                pillTemp,
                controllerTemp: ctrlTemp,
                delta: pillDelta,
                dailyRate,
                progressPercent: progressPct,
                sgHistory: sorted.slice(0, 20).map(s => ({ date: s.date, value: s.value })),
                deltaHistory: (deltaHistoryForAI || []).map(d => ({ delta: parseFloat(String(d.delta)), recorded_at: d.recorded_at })),
                controllerName: fc.name,
                maxTargetTemp: parseFloat(String(fc.max_target_temp ?? '25')),
                minTargetTemp: parseFloat(String(fc.min_target_temp ?? '-5')),
                hoursAtCurrentTemp,
                scenario: 'overshoot',
                heatingActive: true,
              }
            });

            if (!aiResponse.error && aiResponse.data && !aiResponse.data.fallback) {
              const rec = aiResponse.data.recommendation;
              log('OVERSHOOT_AI', 'pass', `AI recommends: ${rec.action} ${rec.degrees}°C (confidence: ${rec.confidence}%)`, {
                action: rec.action,
                degrees: rec.degrees,
                confidence: rec.confidence,
                reasoning: rec.reasoning,
                newTargetTemp: rec.newTargetTemp
              });

              if ((rec.action === 'pause_heating' || rec.action === 'lower_temp') && rec.confidence >= 50) {
                const maxTemp = parseFloat(String(fc.max_target_temp ?? '25'));
                const minTemp = parseFloat(String(fc.min_target_temp ?? '-5'));

                // For pause_heating: set target = controller current temp (equilibrium)
                // This stops heating WITHOUT starting cooling
                // For lower_temp: use AI's suggestion
                let newTarget: number;
                if (rec.action === 'pause_heating') {
                  newTarget = Math.round(ctrlTemp * 2) / 2; // Round to nearest 0.5
                  log('OVERSHOOT_PAUSE', 'info', `Pause heating: target → ctrl temp ${newTarget}°C (ctrl=${ctrlTemp.toFixed(1)}°C)`);
                } else {
                  newTarget = rec.newTargetTemp ?? (targetTemp - rec.degrees);
                }

                newTarget = Math.max(minTemp, Math.min(maxTemp, newTarget));

                if (Math.abs(newTarget - targetTemp) < 0.1) {
                  log('OVERSHOOT_SKIP', 'info', `Target already at ${targetTemp}°C, no change needed`);
                } else {
                  log('OVERSHOOT_ACTION', 'action', `AI: Setting ${fc.name} from ${targetTemp}°C → ${newTarget}°C`);

                  const updateResponse = await supabase.functions.invoke('rapt-update-controller', {
                    body: { controllerId: fc.controller_id, action: 'setTargetTemperature', value: newTarget }
                  });

                  if (!updateResponse.error) {
                    log('OVERSHOOT_ACTION', 'pass', `Successfully set ${fc.name} to ${newTarget}°C`);
                    allAdjustments.push({ cooler: fc.name, oldTarget: targetTemp, newTarget });

                    await supabase.from('auto_cooling_adjustments').insert({
                      cooler_controller_id: fc.controller_id,
                      cooler_controller_name: fc.name,
                      old_target_temp: targetTemp,
                      new_target_temp: newTarget,
                      lowest_followed_temp: targetTemp,
                      followed_controller_id: fc.controller_id,
                      followed_controller_name: fc.name,
                      followed_current_temp: ctrlTemp,
                      followed_target_temp: targetTemp,
                      reason: `🌡️ Overshoot: ${rec.reasoning} (${rec.confidence}% säker)`
                    } as any);
                  } else {
                    log('OVERSHOOT_ACTION', 'fail', `Failed to update ${fc.name}`);
                  }
                }
              } else if (rec.action === 'hold' || rec.action === 'wait') {
                log('OVERSHOOT_AI', 'info', `AI says ${rec.action}: ${rec.reasoning}`);
              }
            } else {
              log('OVERSHOOT_AI', 'fail', 'AI unavailable for overshoot, using simple fallback');
              if (pillTemp > targetTemp + 1.0) {
                // Fallback: set to controller temp (pause heating without starting cooling)
                const fallbackTarget = Math.round(ctrlTemp * 2) / 2;
                const minTemp = parseFloat(String(fc.min_target_temp ?? '-5'));
                if (fallbackTarget >= minTemp) {
                  log('OVERSHOOT_FALLBACK', 'action', `Fallback: Lowering ${fc.name} from ${targetTemp}°C to ${fallbackTarget.toFixed(1)}°C`);
                  const updateResponse = await supabase.functions.invoke('rapt-update-controller', {
                    body: { controllerId: fc.controller_id, action: 'setTargetTemperature', value: fallbackTarget }
                  });
                  if (!updateResponse.error) {
                    allAdjustments.push({ cooler: fc.name, oldTarget: targetTemp, newTarget: fallbackTarget });
                    await supabase.from('auto_cooling_adjustments').insert({
                      cooler_controller_id: fc.controller_id,
                      cooler_controller_name: fc.name,
                      old_target_temp: targetTemp,
                      new_target_temp: fallbackTarget,
                      lowest_followed_temp: targetTemp,
                      followed_controller_id: fc.controller_id,
                      followed_controller_name: fc.name,
                      followed_current_temp: ctrlTemp,
                      followed_target_temp: targetTemp,
                      reason: `🌡️ Overshoot fallback: pill ${pillTemp.toFixed(1)}° > target ${targetTemp}°C, sänker temporärt`
                    } as any);
                  }
                }
              }
            }
          } catch (aiError) {
            log('OVERSHOOT_AI', 'fail', `AI error: ${aiError instanceof Error ? aiError.message : 'Unknown'}`);
          }
        }
      }
    } else {
      log('OVERSHOOT', 'info', 'Overshoot prevention disabled');
    }

    // ====================================================================
    // FEATURE 2: STALL DETECTION (independent toggle)
    // ====================================================================
    if (stallEnabled) {
      log('STALL', 'info', '--- Fermentation stall detection check ---');

      for (const fc of followedControllersFullData) {
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

        // Calculate expected rate based on progress - fermentation naturally slows near FG
        // At >90% progress, the expected rate is much lower, so the threshold should be relaxed
        let effectiveThreshold = stallThreshold;
        let expectedSlowdown = false;
        if (progressPct > 90) {
          // Near FG: rate naturally drops. Only flag stall if SG is still notably above FG
          effectiveThreshold = stallThreshold * 0.3; // Much lower threshold near end
          expectedSlowdown = true;
        } else if (progressPct > 75) {
          effectiveThreshold = stallThreshold * 0.6; // Moderately lower threshold
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
          pill_temp: fc.pill_temp !== null ? parseFloat(String(fc.pill_temp)) : null,
          current_temp: fc.current_temp !== null ? parseFloat(String(fc.current_temp)) : null,
          target_temp: fc.target_temp !== null ? parseFloat(String(fc.target_temp)) : null,
        });

        // Stall conditions: rate below effective threshold, still far from FG, and not too close to completion
        const isStalling = dailyRate < effectiveThreshold && sgToFg > 0.005 && progressPct < 95;

        if (!isStalling) {
          if (expectedSlowdown && progressPct >= 95) {
            log('STALL_CHECK', 'pass', `${brew.name}: Natural slowdown near FG (${progressPct.toFixed(0)}% done, SG ${sgToFg.toFixed(4)} from FG)`);
          } else if (expectedSlowdown) {
            log('STALL_CHECK', 'pass', `${brew.name}: Rate OK for late fermentation (effective threshold: ${effectiveThreshold.toFixed(4)})`);
          } else {
            log('STALL_CHECK', 'pass', `${brew.name}: No stall (rate ${dailyRate.toFixed(4)}/day vs threshold ${effectiveThreshold.toFixed(4)})`);
          }
        }

        if (isStalling) {
          log('STALL_DETECTED', 'action', `Fermentation stall detected for ${brew.name}! Rate ${dailyRate.toFixed(4)}/day, ${(100 - progressPct).toFixed(0)}% remaining`);

          // Fetch context for AI
          const { data: deltaHistoryForAI } = await supabase
            .from('temp_delta_history')
            .select('delta, recorded_at')
            .eq('controller_id', fc.controller_id)
            .order('recorded_at', { ascending: false })
            .limit(10);

          const currentTarget = parseFloat(String(fc.target_temp ?? '20'));
          const { data: tempHistory } = await supabase
            .from('temp_controller_history')
            .select('target_temp, recorded_at')
            .eq('controller_id', fc.controller_id)
            .order('recorded_at', { ascending: false })
            .limit(100);

          let hoursAtCurrentTemp = 0;
          if (tempHistory && tempHistory.length > 0) {
            for (const record of tempHistory) {
              if (Math.abs(parseFloat(String(record.target_temp)) - currentTarget) > 0.1) break;
              const recordTime = new Date(record.recorded_at).getTime();
              hoursAtCurrentTemp = (nowMs - recordTime) / (1000 * 60 * 60);
            }
          }

          const pillTemp = fc.pill_temp !== null ? parseFloat(String(fc.pill_temp)) : null;
          const ctrlTemp = fc.current_temp !== null ? parseFloat(String(fc.current_temp)) : null;
          const currentDelta = (pillTemp !== null && ctrlTemp !== null) ? pillTemp - ctrlTemp : null;

          log('AI_ADVISOR', 'info', `Consulting AI for ${brew.name}...`);

          try {
            const aiResponse = await supabase.functions.invoke('ai-fermentation-advisor', {
              body: {
                brewName: brew.name,
                beerStyle: brew.style || 'Unknown',
                originalGravity: brew.original_gravity,
                finalGravity: brew.final_gravity,
                currentSG: brew.current_sg,
                currentTemp: ctrlTemp ?? currentTarget,
                targetTemp: currentTarget,
                pillTemp,
                controllerTemp: ctrlTemp,
                delta: currentDelta,
                dailyRate,
                progressPercent: progressPct,
                sgHistory: sorted.slice(0, 20).map(s => ({ date: s.date, value: s.value })),
                deltaHistory: (deltaHistoryForAI || []).map(d => ({ delta: parseFloat(String(d.delta)), recorded_at: d.recorded_at })),
                controllerName: fc.name,
                maxTargetTemp: parseFloat(String(fc.max_target_temp ?? '25')),
                minTargetTemp: parseFloat(String(fc.min_target_temp ?? '-5')),
                hoursAtCurrentTemp,
              }
            });

            if (!aiResponse.error && aiResponse.data && !aiResponse.data.fallback) {
              const rec = aiResponse.data.recommendation;
              log('AI_ADVISOR', 'pass', `AI recommends: ${rec.action} ${rec.degrees}°C (confidence: ${rec.confidence}%)`, {
                action: rec.action,
                degrees: rec.degrees,
                confidence: rec.confidence,
                reasoning: rec.reasoning,
                newTargetTemp: rec.newTargetTemp
              });

              if ((rec.action === 'raise_temp' || rec.action === 'lower_temp') && rec.newTargetTemp !== null && rec.confidence >= 50) {
                const newTarget = rec.newTargetTemp;
                const maxTemp = parseFloat(String(fc.max_target_temp ?? '25'));
                const minTemp = parseFloat(String(fc.min_target_temp ?? '-5'));

                if (newTarget >= minTemp && newTarget <= maxTemp) {
                  log('AI_BOOST', 'action', `AI: ${rec.action === 'raise_temp' ? 'Raising' : 'Lowering'} ${fc.name} from ${currentTarget}°C to ${newTarget}°C`);

                  const updateResponse = await supabase.functions.invoke('rapt-update-controller', {
                    body: { controllerId: fc.controller_id, action: 'setTargetTemperature', value: newTarget }
                  });

                  if (!updateResponse.error) {
                    log('AI_BOOST', 'pass', `Successfully set ${fc.name} to ${newTarget}°C`);
                    allAdjustments.push({ cooler: fc.name, oldTarget: currentTarget, newTarget });

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
                      reason: `🧠 AI: ${rec.reasoning} (${rec.confidence}% säker)`
                    } as any);
                  } else {
                    log('AI_BOOST', 'fail', `Failed to update ${fc.name}`);
                  }
                } else {
                  log('AI_BOOST', 'info', `AI suggestion ${newTarget}°C outside bounds [${minTemp}, ${maxTemp}]`);
                }
              } else if (rec.action === 'hold' || rec.action === 'wait') {
                log('AI_ADVISOR', 'info', `AI says ${rec.action}: ${rec.reasoning}`);
              } else if (rec.confidence < 50) {
                log('AI_ADVISOR', 'info', `AI confidence too low (${rec.confidence}%), skipping action`);
              }
            } else {
              // AI failed — fall back to fixed boost
              log('AI_ADVISOR', 'fail', 'AI unavailable, falling back to fixed boost');
              const boostDegrees = settings.auto_boost_degrees ?? 1.0;
              const newTarget = currentTarget + boostDegrees;
              const maxTemp = parseFloat(String(fc.max_target_temp ?? '25'));

              if (newTarget <= maxTemp) {
                log('AUTO_BOOST_FALLBACK', 'action', `Fallback: Boosting ${fc.name} from ${currentTarget}°C to ${newTarget}°C`);

                const updateResponse = await supabase.functions.invoke('rapt-update-controller', {
                  body: { controllerId: fc.controller_id, action: 'setTargetTemperature', value: newTarget }
                });

                if (!updateResponse.error) {
                  log('AUTO_BOOST_FALLBACK', 'pass', `Boosted ${fc.name} to ${newTarget}°C`);
                  allAdjustments.push({ cooler: fc.name, oldTarget: currentTarget, newTarget });

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
                    reason: `Jäsning stannat (${dailyRate.toFixed(4)}/dag, ${(100 - progressPct).toFixed(0)}% kvar) — fallback +${boostDegrees}°C`
                  } as any);
                }
              }
            }
          } catch (aiError) {
            log('AI_ADVISOR', 'fail', `AI error: ${aiError instanceof Error ? aiError.message : 'Unknown'}. Using fallback.`);
            const boostDegrees = settings.auto_boost_degrees ?? 1.0;
            const newTarget = currentTarget + boostDegrees;
            const maxTemp = parseFloat(String(fc.max_target_temp ?? '25'));

            if (newTarget <= maxTemp) {
              const updateResponse = await supabase.functions.invoke('rapt-update-controller', {
                body: { controllerId: fc.controller_id, action: 'setTargetTemperature', value: newTarget }
              });

              if (!updateResponse.error) {
                allAdjustments.push({ cooler: fc.name, oldTarget: currentTarget, newTarget });
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
                  reason: `Jäsning stannat — AI ej tillgänglig, fallback +${boostDegrees}°C`
                } as any);
              }
            }
          }

          // Always create an alert for stall detection
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
        }
      }
    } else {
      log('STALL', 'info', 'Stall detection disabled');
    }

    // ====================================================================
    // FEATURE 3: AUTO COOLING ADJUSTMENT (independent toggle)
    // ====================================================================
    if (coolingEnabled) {
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
            target_temp: coolerController.target_temp,
            current_temp: coolerController.current_temp
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

                const updateResponse = await supabase.functions.invoke('rapt-update-controller', {
                  body: { controllerId: coolerController.controller_id, action: 'setTargetTemperature', value: defaultTemp }
                });

                if (!updateResponse.error) {
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
              target_temp: lowestTargetTemp,
              cooler_target: currentCoolerTarget,
              diff: (currentCoolerTarget - lowestTargetTemp).toFixed(1)
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

                const updateResponse = await supabase.functions.invoke('rapt-update-controller', {
                  body: { controllerId: coolerController.controller_id, action: 'setTargetTemperature', value: newTarget }
                });

                if (!updateResponse.error) {
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
              current_temp: lowestCurrentTemp,
              threshold: coolingThreshold.toFixed(2)
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

                    for (const fc of followedControllersFullData) {
                      if (fc.pill_temp === null || fc.pill_temp === undefined || fc.current_temp === null || fc.current_temp === undefined) continue;

                      const pillTemp = parseFloat(String(fc.pill_temp));
                      const ctrlTemp = parseFloat(String(fc.current_temp));
                      const currentDelta = pillTemp - ctrlTemp;

                      log('DELTA_ANALYSIS', 'info', `${fc.name}: pill=${pillTemp.toFixed(1)}° ctrl=${ctrlTemp.toFixed(1)}° delta=${currentDelta >= 0 ? '+' : ''}${currentDelta.toFixed(1)}°`);

                      const { data: deltaHistory } = await supabase
                        .from('temp_delta_history')
                        .select('delta, recorded_at')
                        .eq('controller_id', fc.controller_id)
                        .order('recorded_at', { ascending: false })
                        .limit(5);

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
                      if (currentDelta > alertThreshold) {
                        const { data: existingAlerts } = await supabase
                          .from('temp_delta_alerts')
                          .select('id')
                          .eq('controller_id', fc.controller_id)
                          .eq('acknowledged', false)
                          .limit(1);

                        if (!existingAlerts || existingAlerts.length === 0) {
                          await supabase.from('temp_delta_alerts').insert({
                            controller_id: fc.controller_id,
                            delta: currentDelta,
                            alert_type: 'high_delta'
                          } as any);
                          log('DELTA_ALERT', 'pass', `Alert created for ${fc.name}`);
                        }
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

                        const updateResponse = await supabase.functions.invoke('rapt-update-controller', {
                          body: { controllerId: coolerController.controller_id, action: 'setTargetTemperature', value: finalTarget }
                        });

                        if (!updateResponse.error) {
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
                  }
                }
              }
            } else {
              // Not actively cooling - reset timer
              await (supabase as any).from('auto_cooling_settings').update({ last_check_at: null }).eq('id', settings.id);
              log('TIMER', 'info', 'Reset timer - not actively cooling');
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
