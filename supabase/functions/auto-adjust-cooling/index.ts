import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    if (settingsError) {
      log('SETTINGS', 'fail', 'Failed to fetch settings', { error: settingsError.message });
      await printSummary(supabase, 'Settings error', false);
      return new Response(JSON.stringify({ message: 'Settings error', decisionLog }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!settings || !settings.enabled) {
      log('SETTINGS', 'fail', 'Auto cooling adjustment is disabled', { enabled: settings?.enabled ?? false });
      await printSummary(supabase, 'Disabled', false);
      return new Response(JSON.stringify({ message: 'Auto adjustment disabled', decisionLog }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    log('SETTINGS', 'pass', 'Settings loaded', {
      check_interval_minutes: settings.check_interval_minutes,
      temp_reduction_degrees: settings.temp_reduction_degrees,
      max_diff_from_lowest: settings.max_diff_from_lowest,
      last_check_at: settings.last_check_at
    });

    if (!settings.cooler_controller_id) {
      log('COOLER_CONFIG', 'fail', 'No cooler controller configured');
      await printSummary(supabase, 'No cooler configured', false);
      return new Response(JSON.stringify({ message: 'No cooler configured', decisionLog }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get followed controllers
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
      await printSummary(supabase, 'Cooler not available', false);
      return new Response(JSON.stringify({ message: 'Cooler not available', decisionLog }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    log('COOLER_STATUS', 'pass', `Cooler: ${coolerController.name}`, {
      target_temp: coolerController.target_temp,
      current_temp: coolerController.current_temp
    });

    // Get data for followed controllers
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

    // Log each followed controller's status
    followedControllersFullData.forEach(controller => {
      const currentTemp = parseFloat(String(controller.current_temp ?? controller.pill_temp ?? '0'));
      const targetTemp = parseFloat(String(controller.target_temp ?? '999'));
      const hysteresis = parseFloat(String(controller.cooling_hysteresis ?? '0.2'));
      const isActivelyCooling = controller.cooling_enabled && currentTemp > (targetTemp + hysteresis);
      
      log('FOLLOWED_DATA', 'info', `Controller: ${controller.name}`, {
        target_temp: targetTemp,
        current_temp: currentTemp,
        cooling_enabled: controller.cooling_enabled,
        is_actively_cooling: isActivelyCooling
      });
    });

    // Find the controller with the lowest target temperature
    const lowestTempController = followedControllersFullData.reduce((lowest, current) => {
      const currentTarget = parseFloat(String(current.target_temp ?? '999'));
      const lowestTarget = parseFloat(String(lowest.target_temp ?? '999'));
      return currentTarget < lowestTarget ? current : lowest;
    });

    const currentCoolerTarget = parseFloat(String(coolerController.target_temp ?? '18'));
    const lowestTargetTemp = parseFloat(String(lowestTempController.target_temp ?? '999'));

    log('LOWEST_CONTROLLER', 'info', `Lowest target: ${lowestTempController.name}`, {
      target_temp: lowestTargetTemp,
      cooler_target: currentCoolerTarget,
      diff: (currentCoolerTarget - lowestTargetTemp).toFixed(1)
    });

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

            await printSummary(supabase, 'Set to default (no cooling)', true);
            return new Response(JSON.stringify({ success: true, adjustments: [{ cooler: coolerController.name, oldTarget: currentCoolerTarget, newTarget: defaultTemp }], decisionLog }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }
      }
      
      await (supabase as any).from('auto_cooling_settings').update({ last_check_at: null }).eq('id', settings.id);
      log('TIMER', 'info', 'Reset timer - no cooling capability');
      await printSummary(supabase, 'No cooling capability', false);
      return new Response(JSON.stringify({ message: 'No cooling capability', resetTimer: true, decisionLog }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    log('COOLING_CAPABILITY', 'pass', `${controllersWithCooling.length} controller(s) have cooling enabled`);

    if (!lowestTempController.cooling_enabled) {
      log('LOWEST_COOLING', 'fail', `${lowestTempController.name} does not have cooling enabled`);
      await (supabase as any).from('auto_cooling_settings').update({ last_check_at: null }).eq('id', settings.id);
      log('TIMER', 'info', 'Reset timer - lowest not cooling');
      await printSummary(supabase, 'Lowest not cooling', false);
      return new Response(JSON.stringify({ message: 'Lowest temp controller cooling not active', resetTimer: true, decisionLog }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    log('LOWEST_COOLING', 'pass', `${lowestTempController.name} has cooling enabled`);

    // Temperature difference analysis
    const tempDiff = currentCoolerTarget - lowestTargetTemp;
    log('TEMP_DIFF', 'info', 'Temperature difference', {
      cooler_target: currentCoolerTarget,
      lowest_target: lowestTargetTemp,
      difference: tempDiff.toFixed(1),
      interpretation: tempDiff > 0 ? 'Cooler is WARMER' : tempDiff < 0 ? 'Cooler is COLDER' : 'Same'
    });

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

          await printSummary(supabase, 'Increased (was too cold)', true);
          return new Response(JSON.stringify({ success: true, adjustments: [{ cooler: coolerController.name, oldTarget: currentCoolerTarget, newTarget }], decisionLog }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } else {
        log('OVERCOOLING_CHECK', 'info', 'No increase needed');
      }
    } else {
      log('OVERCOOLING_CHECK', 'pass', 'Cooler is not overcooling');
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

    if (!isActivelyCooling) {
      await (supabase as any).from('auto_cooling_settings').update({ last_check_at: null }).eq('id', settings.id);
      log('TIMER', 'info', 'Reset timer - at target');
      await printSummary(supabase, 'Not actively cooling', false);
      return new Response(JSON.stringify({ message: 'Lowest controller not actively cooling', resetTimer: true, decisionLog }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check interval
    const now = new Date();
    const checkIntervalMs = settings.check_interval_minutes * 60 * 1000;
    
    if (settings.last_check_at) {
      const lastCheckTime = new Date(settings.last_check_at);
      const timeSinceLastCheck = now.getTime() - lastCheckTime.getTime();
      const remainingMs = checkIntervalMs - timeSinceLastCheck;
      
      log('INTERVAL_CHECK', 'info', 'Time since last adjustment', {
        interval_minutes: settings.check_interval_minutes,
        remaining_minutes: Math.ceil(remainingMs / 60000)
      });

      if (timeSinceLastCheck < checkIntervalMs) {
        const remainingMinutes = Math.ceil(remainingMs / 60000);
        log('INTERVAL_CHECK', 'fail', `Must wait ${remainingMinutes} more minutes`);
        await printSummary(supabase, `Wait ${remainingMinutes}min`, false);
        return new Response(JSON.stringify({ message: `Wait ${remainingMinutes} more minutes`, minutesRemaining: remainingMinutes, decisionLog }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      log('INTERVAL_CHECK', 'pass', 'Enough time has passed');
    } else {
      log('INTERVAL_CHECK', 'pass', 'No previous check recorded');
    }

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
      await printSummary(supabase, 'Not enough history', false);
      return new Response(JSON.stringify({ message: 'Not enough data yet', decisionLog }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    log('HISTORY_CHECK', 'pass', `Found ${history.length} history records`);

    // Check if all history records show active cooling
    const allActivelyCooling = history.every(record => {
      return record.cooling_enabled === true && record.current_temp > (record.target_temp + lowestHysteresis);
    });
    
    log('SUSTAINED_COOLING_CHECK', allActivelyCooling ? 'pass' : 'fail', 
      allActivelyCooling ? 'Controller has been trying to cool for entire interval' : 'Controller was NOT actively cooling for entire interval');
    
    if (!allActivelyCooling) {
      await (supabase as any).from('auto_cooling_settings').update({ last_check_at: new Date().toISOString() }).eq('id', settings.id);
      log('TIMER', 'info', 'Updated last_check_at');
      await printSummary(supabase, 'Not sustained cooling', false);
      return new Response(JSON.stringify({ message: 'Not actively cooling entire period', decisionLog }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    log('DECISION', 'action', `${lowestTempController.name} has been struggling to cool`, {
      current_temp: lowestCurrentTemp,
      target_temp: lowestTargetTemp
    });
    
    await (supabase as any).from('auto_cooling_settings').update({ last_check_at: new Date().toISOString() }).eq('id', settings.id);
    log('TIMER', 'info', 'Updated last_check_at');

    const adjustments: Array<{ cooler: string; oldTarget: number; newTarget: number }> = [];
    const strugglingController = lowestTempController;

    // Round current cooler target to nearest integer to avoid floating point issues from RAPT API
    const roundedCoolerTarget = Math.round(currentCoolerTarget);
    const proposedNewTarget = roundedCoolerTarget - parseFloat(String(settings.temp_reduction_degrees));
    const maxAllowedTarget = lowestTargetTemp - parseFloat(String(settings.max_diff_from_lowest));
    
    // Always use integer targets
    let finalTarget = Math.round(proposedNewTarget);
    if (finalTarget < Math.round(maxAllowedTarget)) {
      finalTarget = Math.round(maxAllowedTarget);
      log('TARGET_CALCULATION', 'info', `Limited by max_diff_from_lowest to ${finalTarget}°C`);
    }

    log('TARGET_CALCULATION', 'info', 'New target calculated', {
      current: roundedCoolerTarget,
      proposed: proposedNewTarget,
      final: finalTarget
    });

    if (finalTarget < roundedCoolerTarget) {
      const coolerMinTemp = parseFloat(String(coolerController.min_target_temp ?? '-5'));
      const coolerMaxTemp = parseFloat(String(coolerController.max_target_temp ?? '25'));
      
      if (finalTarget < coolerMinTemp) {
        log('ADJUSTMENT', 'fail', `Cannot set cooler below minimum (${coolerMinTemp}°C)`);
      } else if (finalTarget > coolerMaxTemp) {
        log('ADJUSTMENT', 'fail', `Cannot set cooler above maximum (${coolerMaxTemp}°C)`);
      } else {
        log('ADJUSTMENT', 'action', `Lowering cooler from ${roundedCoolerTarget}°C to ${finalTarget}°C`);
        
        const updateResponse = await supabase.functions.invoke('rapt-update-controller', {
          body: { controllerId: coolerController.controller_id, action: 'setTargetTemperature', value: finalTarget }
        });

        if (updateResponse.error) {
          log('ADJUSTMENT', 'fail', 'Failed to update cooler controller');
        } else {
          log('ADJUSTMENT', 'pass', `Updated cooler to ${finalTarget}°C`);
          adjustments.push({ cooler: coolerController.name, oldTarget: roundedCoolerTarget, newTarget: finalTarget });

          const lowestFollowedTemp = followedControllersFullData
            .map(c => parseFloat(String(c.current_temp ?? c.pill_temp ?? '999')))
            .reduce((min, temp) => Math.min(min, temp), 999);

          await supabase.from('auto_cooling_adjustments').insert({
            cooler_controller_id: coolerController.controller_id,
            cooler_controller_name: coolerController.name,
            old_target_temp: roundedCoolerTarget,
            new_target_temp: finalTarget,
            lowest_followed_temp: lowestFollowedTemp,
            followed_controller_id: strugglingController.controller_id,
            followed_controller_name: strugglingController.name,
            followed_current_temp: parseFloat(String(strugglingController.current_temp ?? strugglingController.pill_temp ?? '0')),
            followed_target_temp: parseFloat(String(strugglingController.target_temp ?? '0')),
            followed_hysteresis: parseFloat(String(strugglingController.cooling_hysteresis ?? '0.2')),
            reason: `${strugglingController.name} struggling to cool`
          } as any);
          
          log('DB_LOG', 'pass', 'Adjustment logged to database');
        }
      }
    } else {
      log('ADJUSTMENT', 'info', 'Cooler target would not be lowered');
    }

    log('COMPLETE', 'info', `Completed`, { adjustments_made: adjustments.length });
    await printSummary(supabase, adjustments.length > 0 ? 'Adjustment made' : 'No adjustment needed', adjustments.length > 0);

    return new Response(JSON.stringify({ success: true, adjustments, message: `Made ${adjustments.length} adjustments`, decisionLog }), {
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
