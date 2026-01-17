import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Decision log entry type
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

  // Collect all decision points for summary logging
  const decisionLog: DecisionLogEntry[] = [];
  const startTime = Date.now();

  const log = (step: string, result: 'pass' | 'fail' | 'info' | 'action', message: string, details?: Record<string, unknown>) => {
    const entry: DecisionLogEntry = { step, result, message, details };
    decisionLog.push(entry);
    const icon = result === 'pass' ? '✅' : result === 'fail' ? '❌' : result === 'action' ? '🔧' : 'ℹ️';
    console.log(`${icon} [${step}] ${message}`, details ? JSON.stringify(details) : '');
  };

  const printSummary = () => {
    const duration = Date.now() - startTime;
    console.log('\n' + '='.repeat(60));
    console.log('📊 AUTO-COOLING DECISION SUMMARY');
    console.log('='.repeat(60));
    console.log(`⏱️  Duration: ${duration}ms`);
    console.log(`📝 Total decisions: ${decisionLog.length}`);
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
  };

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    log('START', 'info', 'Starting auto cooling adjustment check', { timestamp: new Date().toISOString() });

    // Get settings
    const { data: settings, error: settingsError } = await supabase
      .from('auto_cooling_settings')
      .select('*')
      .limit(1)
      .single();

    if (settingsError) {
      log('SETTINGS', 'fail', 'Failed to fetch settings', { error: settingsError.message });
      printSummary();
      return new Response(JSON.stringify({ message: 'Settings error', decisionLog }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!settings || !settings.enabled) {
      log('SETTINGS', 'fail', 'Auto cooling adjustment is disabled', { enabled: settings?.enabled ?? false });
      printSummary();
      return new Response(JSON.stringify({ message: 'Auto adjustment disabled', decisionLog }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    log('SETTINGS', 'pass', 'Settings loaded successfully', {
      enabled: settings.enabled,
      check_interval_minutes: settings.check_interval_minutes,
      temp_reduction_degrees: settings.temp_reduction_degrees,
      max_diff_from_lowest: settings.max_diff_from_lowest,
      cooler_controller_id: settings.cooler_controller_id,
      last_check_at: settings.last_check_at
    });

    // Check if cooler controller is set
    if (!settings.cooler_controller_id) {
      log('COOLER_CONFIG', 'fail', 'No cooler controller configured');
      printSummary();
      return new Response(JSON.stringify({ message: 'No cooler configured', decisionLog }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get followed controllers
    const { data: followedControllers, error: followedError } = await supabase
      .from('auto_cooling_followed_controllers')
      .select('controller_id');

    if (followedError || !followedControllers || followedControllers.length === 0) {
      log('FOLLOWED_CONTROLLERS', 'fail', 'No followed controllers configured', { 
        error: followedError?.message,
        count: followedControllers?.length ?? 0
      });
      printSummary();
      return new Response(JSON.stringify({ message: 'No followed controllers', decisionLog }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const followedControllerIds = followedControllers.map(c => c.controller_id);
    log('FOLLOWED_CONTROLLERS', 'pass', `Found ${followedControllerIds.length} followed controller(s)`, { ids: followedControllerIds });

    // Get cooler controller data
    const { data: coolerController, error: coolerError } = await supabase
      .from('rapt_temp_controllers')
      .select('*')
      .eq('controller_id', settings.cooler_controller_id)
      .eq('cooling_enabled', true)
      .single();

    if (coolerError || !coolerController) {
      log('COOLER_STATUS', 'fail', 'Cooler controller not found or cooling not enabled', { 
        error: coolerError?.message,
        controller_id: settings.cooler_controller_id
      });
      printSummary();
      return new Response(JSON.stringify({ message: 'Cooler not available', decisionLog }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    log('COOLER_STATUS', 'pass', `Cooler controller found: ${coolerController.name}`, {
      name: coolerController.name,
      target_temp: coolerController.target_temp,
      current_temp: coolerController.current_temp,
      cooling_enabled: coolerController.cooling_enabled,
      min_target_temp: coolerController.min_target_temp,
      max_target_temp: coolerController.max_target_temp
    });

    // Get data for followed controllers
    const { data: followedControllersFullData, error: followedDataError } = await supabase
      .from('rapt_temp_controllers')
      .select('*')
      .in('controller_id', followedControllerIds);

    if (followedDataError || !followedControllersFullData || followedControllersFullData.length === 0) {
      log('FOLLOWED_DATA', 'fail', 'No followed controllers data found', { error: followedDataError?.message });
      printSummary();
      return new Response(JSON.stringify({ message: 'No followed controllers data', decisionLog }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Log each followed controller's status
    followedControllersFullData.forEach(controller => {
      const currentTemp = parseFloat(controller.current_temp ?? controller.pill_temp ?? '0');
      const targetTemp = parseFloat(controller.target_temp || '999');
      const hysteresis = parseFloat(controller.cooling_hysteresis ?? '0.2');
      const isActivelyCooling = controller.cooling_enabled && currentTemp > (targetTemp + hysteresis);
      
      log('FOLLOWED_DATA', 'info', `Controller: ${controller.name}`, {
        name: controller.name,
        target_temp: targetTemp,
        current_temp: currentTemp,
        cooling_enabled: controller.cooling_enabled,
        hysteresis: hysteresis,
        is_actively_cooling: isActivelyCooling,
        temp_above_target: currentTemp > targetTemp ? `+${(currentTemp - targetTemp).toFixed(2)}°C` : `${(currentTemp - targetTemp).toFixed(2)}°C`
      });
    });

    // Find the controller with the lowest target temperature
    const lowestTempController = followedControllersFullData.reduce((lowest, current) => {
      const currentTarget = parseFloat(current.target_temp || '999');
      const lowestTarget = parseFloat(lowest.target_temp || '999');
      return currentTarget < lowestTarget ? current : lowest;
    });

    const currentCoolerTarget = parseFloat(coolerController.target_temp || '18');
    const lowestTargetTemp = parseFloat(lowestTempController.target_temp || '999');

    log('LOWEST_CONTROLLER', 'info', `Controller with lowest target: ${lowestTempController.name}`, {
      name: lowestTempController.name,
      target_temp: lowestTargetTemp,
      cooler_target: currentCoolerTarget,
      diff_cooler_to_lowest: (currentCoolerTarget - lowestTargetTemp).toFixed(1)
    });

    // Check if any followed controller has cooling enabled
    const controllersWithCooling = followedControllersFullData.filter(c => c.cooling_enabled === true);
    const hasAnyCoolingCapability = controllersWithCooling.length > 0;

    if (!hasAnyCoolingCapability) {
      log('COOLING_CAPABILITY', 'fail', 'No followed controller has cooling enabled', {
        controllers_checked: followedControllersFullData.length,
        controllers_with_cooling: 0
      });
      
      const defaultTemp = 18;
      
      // Only update if current target is different from default
      if (Math.abs(currentCoolerTarget - defaultTemp) > 0.1) {
        const coolerMinTemp = parseFloat(coolerController.min_target_temp || '-5');
        const coolerMaxTemp = parseFloat(coolerController.max_target_temp || '25');
        
        if (defaultTemp >= coolerMinTemp && defaultTemp <= coolerMaxTemp) {
          log('ADJUSTMENT', 'action', `Setting cooler to default ${defaultTemp}°C (no active cooling)`, {
            old_target: currentCoolerTarget,
            new_target: defaultTemp
          });

          const updateResponse = await supabase.functions.invoke('rapt-update-controller', {
            body: {
              controllerId: coolerController.controller_id,
              action: 'setTargetTemperature',
              value: defaultTemp
            }
          });

          if (updateResponse.error) {
            log('ADJUSTMENT', 'fail', 'Failed to set cooler to default', { error: updateResponse.error });
          } else {
            log('ADJUSTMENT', 'pass', `Successfully set cooler to default ${defaultTemp}°C`);
            
            await supabase
              .from('auto_cooling_adjustments')
              .insert({
                cooler_controller_id: coolerController.controller_id,
                cooler_controller_name: coolerController.name,
                old_target_temp: currentCoolerTarget,
                new_target_temp: defaultTemp,
                lowest_followed_temp: 0,
                followed_controller_id: null,
                followed_controller_name: null,
                followed_current_temp: null,
                followed_target_temp: null,
                followed_hysteresis: null,
                reason: `Ingen följd controller är aktiv med kyla`
              });

            printSummary();
            return new Response(JSON.stringify({ 
              success: true, 
              adjustments: [{
                cooler: coolerController.name,
                oldTarget: currentCoolerTarget,
                newTarget: defaultTemp,
                reason: 'Ingen cooling aktiv - standardtemp 18°C'
              }],
              decisionLog
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }
      } else {
        log('ADJUSTMENT', 'info', `Cooler already at default ${defaultTemp}°C, no change needed`);
      }
      
      // Reset timer since no cooling capability
      await supabase
        .from('auto_cooling_settings')
        .update({ last_check_at: null })
        .eq('id', settings.id);

      log('TIMER', 'info', 'Reset timer (last_check_at = null) - no cooling capability');
      printSummary();
      return new Response(JSON.stringify({ 
        message: 'No cooling capability, cooler at default',
        resetTimer: true,
        decisionLog
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    log('COOLING_CAPABILITY', 'pass', `${controllersWithCooling.length} controller(s) have cooling enabled`, {
      controllers: controllersWithCooling.map(c => c.name)
    });

    // If lowest temp controller doesn't have cooling enabled, skip further checks
    if (!lowestTempController.cooling_enabled) {
      log('LOWEST_COOLING', 'fail', `Lowest temp controller ${lowestTempController.name} does not have cooling enabled`, {
        controller: lowestTempController.name,
        cooling_enabled: false
      });
      
      // Reset last_check_at since cooling is not active
      await supabase
        .from('auto_cooling_settings')
        .update({ last_check_at: null })
        .eq('id', settings.id);

      log('TIMER', 'info', 'Reset timer (last_check_at = null) - lowest controller not cooling');
      printSummary();
      return new Response(JSON.stringify({ 
        message: 'Lowest temp controller cooling not active',
        resetTimer: true,
        decisionLog
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    log('LOWEST_COOLING', 'pass', `Lowest temp controller ${lowestTempController.name} has cooling enabled`);

    // Temperature difference analysis
    // tempDiff > 0 means cooler is WARMER than lowest controller
    // tempDiff < 0 means cooler is COLDER than lowest controller
    const tempDiff = currentCoolerTarget - lowestTargetTemp;
    
    log('TEMP_DIFF', 'info', 'Analyzing temperature difference', {
      cooler_target: currentCoolerTarget,
      lowest_target: lowestTargetTemp,
      difference: tempDiff.toFixed(1),
      interpretation: tempDiff > 0 ? 'Cooler is WARMER than lowest' : tempDiff < 0 ? 'Cooler is COLDER than lowest' : 'Same temperature'
    });

    // Check if cooler is more than 10 degrees COLDER than lowest controller (tempDiff < -10)
    // In this case we should INCREASE the cooler temp since it's unnecessarily cold
    if (tempDiff < -10) {
      log('OVERCOOLING_CHECK', 'info', `Cooler is ${Math.abs(tempDiff).toFixed(1)}°C colder than lowest controller - checking if increase needed`, {
        threshold: 10,
        actual_diff: Math.abs(tempDiff).toFixed(1)
      });
      
      const newTarget = lowestTargetTemp - 10; // Set to 10 degrees below lowest controller
      
      // Check against cooler's own min/max limits
      const coolerMinTemp = parseFloat(coolerController.min_target_temp || '-5');
      const coolerMaxTemp = parseFloat(coolerController.max_target_temp || '25');
      
      // Only increase if newTarget is actually higher than current
      if (newTarget > currentCoolerTarget && newTarget >= coolerMinTemp && newTarget <= coolerMaxTemp) {
        log('ADJUSTMENT', 'action', `Increasing cooler temperature (was too cold)`, {
          old_target: currentCoolerTarget,
          new_target: newTarget,
          reason: 'Maintaining 10°C diff from lowest controller'
        });

        const updateResponse = await supabase.functions.invoke('rapt-update-controller', {
          body: {
            controllerId: coolerController.controller_id,
            action: 'setTargetTemperature',
            value: newTarget
          }
        });

        if (updateResponse.error) {
          log('ADJUSTMENT', 'fail', 'Failed to increase cooler temperature', { error: updateResponse.error });
        } else {
          log('ADJUSTMENT', 'pass', `Successfully increased cooler from ${currentCoolerTarget}°C to ${newTarget}°C`);
          
          await supabase
            .from('auto_cooling_adjustments')
            .insert({
              cooler_controller_id: coolerController.controller_id,
              cooler_controller_name: coolerController.name,
              old_target_temp: currentCoolerTarget,
              new_target_temp: newTarget,
              lowest_followed_temp: lowestTargetTemp,
              followed_controller_id: lowestTempController.controller_id,
              followed_controller_name: lowestTempController.name,
              followed_current_temp: parseFloat(lowestTempController.current_temp ?? lowestTempController.pill_temp ?? '0'),
              followed_target_temp: lowestTargetTemp,
              followed_hysteresis: parseFloat(lowestTempController.cooling_hysteresis ?? '0.2'),
              reason: `Cooler was ${Math.abs(tempDiff).toFixed(1)}°C colder than needed - increased to maintain 10°C diff`
            });

          printSummary();
          return new Response(JSON.stringify({ 
            success: true, 
            adjustments: [{
              cooler: coolerController.name,
              oldTarget: currentCoolerTarget,
              newTarget: newTarget,
              reason: `Increased - was ${Math.abs(tempDiff).toFixed(1)}°C colder than needed`
            }],
            decisionLog
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } else {
        log('OVERCOOLING_CHECK', 'info', 'No increase needed despite being cold', {
          new_target_would_be: newTarget,
          current_target: currentCoolerTarget,
          would_increase: newTarget > currentCoolerTarget,
          within_limits: newTarget >= coolerMinTemp && newTarget <= coolerMaxTemp,
          cooler_min: coolerMinTemp,
          cooler_max: coolerMaxTemp
        });
      }
    } else {
      log('OVERCOOLING_CHECK', 'pass', 'Cooler is not overcooling (within 10°C of lowest)', {
        difference: tempDiff.toFixed(1),
        threshold: -10
      });
    }

    // Check if lowest controller is actively cooling (current_temp > target_temp + hysteresis)
    const lowestCurrentTemp = parseFloat(lowestTempController.current_temp ?? lowestTempController.pill_temp ?? '0');
    const lowestHysteresis = parseFloat(lowestTempController.cooling_hysteresis ?? '0.2');
    const coolingThreshold = lowestTargetTemp + lowestHysteresis;
    const isActivelyCooling = lowestCurrentTemp > coolingThreshold;

    log('ACTIVE_COOLING_CHECK', isActivelyCooling ? 'pass' : 'info', 
      isActivelyCooling 
        ? `${lowestTempController.name} IS actively cooling`
        : `${lowestTempController.name} is NOT actively cooling`, {
      current_temp: lowestCurrentTemp,
      target_temp: lowestTargetTemp,
      hysteresis: lowestHysteresis,
      cooling_threshold: coolingThreshold.toFixed(2),
      temp_above_threshold: isActivelyCooling ? `+${(lowestCurrentTemp - coolingThreshold).toFixed(2)}°C` : 'N/A',
      conclusion: isActivelyCooling ? 'Needs to cool down' : 'Already at or below target'
    });

    if (!isActivelyCooling) {
      // Reset timer since not actively cooling
      await supabase
        .from('auto_cooling_settings')
        .update({ last_check_at: null })
        .eq('id', settings.id);

      log('TIMER', 'info', 'Reset timer (last_check_at = null) - controller at target temp');
      printSummary();
      return new Response(JSON.stringify({ 
        message: 'Lowest controller not actively cooling',
        resetTimer: true,
        decisionLog
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if enough time has passed since last check
    const now = new Date();
    const checkIntervalMs = settings.check_interval_minutes * 60 * 1000;
    
    if (settings.last_check_at) {
      const lastCheckTime = new Date(settings.last_check_at);
      const timeSinceLastCheck = now.getTime() - lastCheckTime.getTime();
      const remainingMs = checkIntervalMs - timeSinceLastCheck;
      
      log('INTERVAL_CHECK', 'info', 'Checking time since last adjustment', {
        last_check_at: settings.last_check_at,
        interval_minutes: settings.check_interval_minutes,
        time_since_last_check_minutes: Math.round(timeSinceLastCheck / 60000),
        remaining_minutes: Math.ceil(remainingMs / 60000)
      });

      if (timeSinceLastCheck < checkIntervalMs) {
        const remainingMinutes = Math.ceil(remainingMs / 60000);
        log('INTERVAL_CHECK', 'fail', `Must wait ${remainingMinutes} more minutes before next adjustment`);
        printSummary();
        return new Response(JSON.stringify({ 
          message: `Wait ${remainingMinutes} more minutes`,
          minutesRemaining: remainingMinutes,
          decisionLog
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      log('INTERVAL_CHECK', 'pass', 'Enough time has passed since last check');
    } else {
      log('INTERVAL_CHECK', 'pass', 'No previous check recorded (first check or timer was reset)');
    }

    // Check if we have enough history data
    const checkTime = new Date(Date.now() - settings.check_interval_minutes * 60 * 1000);
    
    const { data: history, error: historyError } = await supabase
      .from('temp_controller_history')
      .select('*')
      .eq('controller_id', lowestTempController.controller_id)
      .gte('recorded_at', checkTime.toISOString())
      .order('recorded_at', { ascending: false });

    if (historyError || !history || history.length < 2) {
      log('HISTORY_CHECK', 'fail', 'Not enough history data for analysis', {
        error: historyError?.message,
        records_found: history?.length ?? 0,
        records_needed: 2,
        time_range: `Last ${settings.check_interval_minutes} minutes`
      });
      printSummary();
      return new Response(JSON.stringify({ message: 'Not enough data yet', decisionLog }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    log('HISTORY_CHECK', 'pass', `Found ${history.length} history records`, {
      records: history.length,
      time_range: `Last ${settings.check_interval_minutes} minutes`,
      oldest_record: history[history.length - 1]?.recorded_at,
      newest_record: history[0]?.recorded_at
    });

    // Check if all history records show active cooling (temp > target + hysteresis)
    const historyAnalysis = history.map(record => {
      const currentTemp = parseFloat(record.current_temp);
      const targetTemp = parseFloat(record.target_temp);
      const wasActivelyCooling = record.cooling_enabled === true && currentTemp > (targetTemp + lowestHysteresis);
      return {
        recorded_at: record.recorded_at,
        current_temp: currentTemp,
        target_temp: targetTemp,
        cooling_enabled: record.cooling_enabled,
        was_actively_cooling: wasActivelyCooling
      };
    });

    const allActivelyCooling = historyAnalysis.every(h => h.was_actively_cooling);
    const recordsNotCooling = historyAnalysis.filter(h => !h.was_actively_cooling);
    
    log('SUSTAINED_COOLING_CHECK', allActivelyCooling ? 'pass' : 'fail', 
      allActivelyCooling 
        ? `Controller has been trying to cool for entire ${settings.check_interval_minutes} minute interval`
        : `Controller was NOT actively cooling for entire interval`, {
      total_records: history.length,
      records_actively_cooling: history.length - recordsNotCooling.length,
      records_not_cooling: recordsNotCooling.length,
      sample_not_cooling: recordsNotCooling.slice(0, 3).map(r => ({
        time: r.recorded_at,
        temp: r.current_temp,
        target: r.target_temp
      }))
    });
    
    if (!allActivelyCooling) {
      // Update last_check_at since we did the check
      await supabase
        .from('auto_cooling_settings')
        .update({ last_check_at: new Date().toISOString() })
        .eq('id', settings.id);
      
      log('TIMER', 'info', 'Updated last_check_at - countdown restarted (not sustained cooling)');
      printSummary();
      return new Response(JSON.stringify({ message: 'Not actively cooling entire period', decisionLog }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    log('DECISION', 'action', `Controller ${lowestTempController.name} has been struggling to cool - will adjust cooler`, {
      controller: lowestTempController.name,
      current_temp: lowestCurrentTemp,
      target_temp: lowestTargetTemp,
      sustained_minutes: settings.check_interval_minutes
    });
    
    // Update last_check_at since we're doing the adjustment
    await supabase
      .from('auto_cooling_settings')
      .update({ last_check_at: new Date().toISOString() })
      .eq('id', settings.id);
    
    log('TIMER', 'info', 'Updated last_check_at - countdown restarted');

    const adjustments = [];
    const strugglingController = lowestTempController;

    const proposedNewTarget = currentCoolerTarget - parseFloat(settings.temp_reduction_degrees);
    const maxAllowedTarget = lowestTargetTemp - parseFloat(settings.max_diff_from_lowest);
    
    let finalTarget = proposedNewTarget;
    let limitReason = null;
    
    if (proposedNewTarget < maxAllowedTarget) {
      finalTarget = maxAllowedTarget;
      limitReason = `Limited by max_diff_from_lowest (${settings.max_diff_from_lowest}°C)`;
    }

    log('TARGET_CALCULATION', 'info', 'Calculating new cooler target', {
      current_cooler_target: currentCoolerTarget,
      reduction_degrees: settings.temp_reduction_degrees,
      proposed_new_target: proposedNewTarget.toFixed(1),
      max_diff_from_lowest: settings.max_diff_from_lowest,
      lowest_controller_target: lowestTargetTemp,
      max_allowed_target: maxAllowedTarget.toFixed(1),
      final_target: finalTarget.toFixed(1),
      limit_applied: limitReason
    });

    // Only adjust if we're actually lowering the target
    if (finalTarget < currentCoolerTarget) {
      // Check against cooler's own min/max limits
      const coolerMinTemp = parseFloat(coolerController.min_target_temp || '-5');
      const coolerMaxTemp = parseFloat(coolerController.max_target_temp || '25');
      
      log('LIMITS_CHECK', 'info', 'Checking cooler temperature limits', {
        final_target: finalTarget.toFixed(1),
        cooler_min: coolerMinTemp,
        cooler_max: coolerMaxTemp,
        within_limits: finalTarget >= coolerMinTemp && finalTarget <= coolerMaxTemp
      });
      
      if (finalTarget < coolerMinTemp) {
        log('ADJUSTMENT', 'fail', `Cannot set cooler below its minimum (${coolerMinTemp}°C)`, {
          requested: finalTarget.toFixed(1),
          minimum: coolerMinTemp
        });
      } else if (finalTarget > coolerMaxTemp) {
        log('ADJUSTMENT', 'fail', `Cannot set cooler above its maximum (${coolerMaxTemp}°C)`, {
          requested: finalTarget.toFixed(1),
          maximum: coolerMaxTemp
        });
      } else {
        log('ADJUSTMENT', 'action', `Lowering cooler temperature`, {
          old_target: currentCoolerTarget,
          new_target: finalTarget,
          change: (currentCoolerTarget - finalTarget).toFixed(1),
          reason: `${strugglingController.name} struggling to cool`
        });
        
        // Call the update controller function for the COOLER
        const updateResponse = await supabase.functions.invoke('rapt-update-controller', {
          body: {
            controllerId: coolerController.controller_id,
            action: 'setTargetTemperature',
            value: finalTarget
          }
        });

        if (updateResponse.error) {
          log('ADJUSTMENT', 'fail', `Failed to update cooler controller`, { error: updateResponse.error });
        } else {
          log('ADJUSTMENT', 'pass', `Successfully updated cooler from ${currentCoolerTarget}°C to ${finalTarget}°C`);
          adjustments.push({
            cooler: coolerController.name,
            oldTarget: currentCoolerTarget,
            newTarget: finalTarget,
            reason: `Followed controller ${strugglingController.name} struggling to cool`
          });

          // Log the adjustment to database
          const lowestFollowedTemp = followedControllersFullData
            .map(c => parseFloat(c.current_temp || c.pill_temp || '999'))
            .reduce((min, temp) => Math.min(min, temp), 999);

          const { error: logError } = await supabase
            .from('auto_cooling_adjustments')
            .insert({
              cooler_controller_id: coolerController.controller_id,
              cooler_controller_name: coolerController.name,
              old_target_temp: currentCoolerTarget,
              new_target_temp: finalTarget,
              lowest_followed_temp: lowestFollowedTemp,
              followed_controller_id: strugglingController.controller_id,
              followed_controller_name: strugglingController.name,
              followed_current_temp: parseFloat(strugglingController.current_temp ?? strugglingController.pill_temp ?? '0'),
              followed_target_temp: parseFloat(strugglingController.target_temp || '0'),
              followed_hysteresis: parseFloat(strugglingController.cooling_hysteresis ?? '0.2'),
              reason: `${strugglingController.name} struggling to cool`
            });

          if (logError) {
            log('DB_LOG', 'fail', 'Failed to log adjustment to database', { error: logError.message });
          } else {
            log('DB_LOG', 'pass', 'Adjustment logged to database');
          }
        }
      }
    } else {
      log('ADJUSTMENT', 'info', 'Cooler target would not be lowered - skipping adjustment', {
        final_target: finalTarget.toFixed(1),
        current_target: currentCoolerTarget,
        would_lower: finalTarget < currentCoolerTarget
      });
    }

    log('COMPLETE', 'info', `Auto adjustment check completed`, { adjustments_made: adjustments.length });
    printSummary();

    return new Response(JSON.stringify({ 
      success: true, 
      adjustments,
      message: `Made ${adjustments.length} adjustments`,
      decisionLog
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    log('ERROR', 'fail', 'Unexpected error in auto-adjust-cooling function', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    printSummary();
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error', decisionLog }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
