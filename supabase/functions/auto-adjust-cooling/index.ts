import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Starting auto cooling adjustment check...');

    // Get settings
    const { data: settings, error: settingsError } = await supabase
      .from('auto_cooling_settings')
      .select('*')
      .limit(1)
      .single();

    if (settingsError || !settings || !settings.enabled) {
      console.log('Auto cooling adjustment is disabled or settings not found');
      return new Response(JSON.stringify({ message: 'Auto adjustment disabled' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Settings:', settings);

    // Check if cooler controller is set
    if (!settings.cooler_controller_id) {
      console.log('No cooler controller configured');
      return new Response(JSON.stringify({ message: 'No cooler configured' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get followed controllers
    const { data: followedControllers, error: followedError } = await supabase
      .from('auto_cooling_followed_controllers')
      .select('controller_id');

    if (followedError || !followedControllers || followedControllers.length === 0) {
      console.log('No followed controllers configured');
      return new Response(JSON.stringify({ message: 'No followed controllers' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const followedControllerIds = followedControllers.map(c => c.controller_id);
    console.log('Followed controllers:', followedControllerIds);

    // Get cooler controller data
    const { data: coolerController, error: coolerError } = await supabase
      .from('rapt_temp_controllers')
      .select('*')
      .eq('controller_id', settings.cooler_controller_id)
      .eq('cooling_enabled', true)
      .single();

    if (coolerError || !coolerController) {
      console.log('Cooler controller not found or cooling not enabled');
      return new Response(JSON.stringify({ message: 'Cooler not available' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Cooler controller: ${coolerController.name} (${coolerController.controller_id})`);

    // Get data for followed controllers
    const { data: followedControllersFullData, error: followedDataError } = await supabase
      .from('rapt_temp_controllers')
      .select('*')
      .in('controller_id', followedControllerIds);

    if (followedDataError || !followedControllersFullData || followedControllersFullData.length === 0) {
      console.log('No followed controllers data found');
      return new Response(JSON.stringify({ message: 'No followed controllers data' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Find the controller with the lowest target temperature
    const lowestTempController = followedControllersFullData.reduce((lowest, current) => {
      const currentTarget = parseFloat(current.target_temp || '999');
      const lowestTarget = parseFloat(lowest.target_temp || '999');
      return currentTarget < lowestTarget ? current : lowest;
    });

    console.log(`Controller with lowest target temp: ${lowestTempController.name} (${lowestTempController.target_temp}°C)`);

    // Check if the lowest temp controller has cooling enabled
    if (!lowestTempController.cooling_enabled) {
      console.log(`Lowest temp controller ${lowestTempController.name} does not have cooling enabled - resetting last_check_at`);
      
      // Reset last_check_at since cooling is not active
      await supabase
        .from('auto_cooling_settings')
        .update({ last_check_at: null })
        .eq('id', settings.id);

      return new Response(JSON.stringify({ 
        message: 'Lowest temp controller cooling not active',
        resetTimer: true 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const currentCoolerTarget = parseFloat(coolerController.target_temp || '18');
    const lowestTargetTemp = parseFloat(lowestTempController.target_temp || '999');
    const tempDiff = currentCoolerTarget - lowestTargetTemp;

    console.log(`Cooler target: ${currentCoolerTarget}°C, Lowest controller target: ${lowestTargetTemp}°C, Diff: ${tempDiff.toFixed(1)}°C`);

    // Check if cooler is more than 10 degrees colder than lowest controller
    if (tempDiff > 10) {
      console.log(`Cooler is ${tempDiff.toFixed(1)}°C colder than lowest controller - increasing cooler temperature`);
      
      const newTarget = lowestTargetTemp - 10; // Set to 10 degrees below lowest controller
      
      // Check against cooler's own min/max limits
      const coolerMinTemp = parseFloat(coolerController.min_target_temp || '-5');
      const coolerMaxTemp = parseFloat(coolerController.max_target_temp || '25');
      
      if (newTarget >= coolerMinTemp && newTarget <= coolerMaxTemp) {
        const updateResponse = await supabase.functions.invoke('rapt-update-controller', {
          body: {
            controllerId: coolerController.controller_id,
            action: 'setTargetTemperature',
            value: newTarget
          }
        });

        if (updateResponse.error) {
          console.error(`Failed to increase cooler temperature:`, updateResponse.error);
        } else {
          console.log(`Successfully increased cooler from ${currentCoolerTarget}°C to ${newTarget}°C`);
          
          // Log the adjustment
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
              followed_current_temp: parseFloat(lowestTempController.pill_temp ?? lowestTempController.current_temp ?? '0'),
              followed_target_temp: lowestTargetTemp,
              followed_hysteresis: parseFloat(lowestTempController.cooling_hysteresis ?? '0.2'),
              reason: `Cooler was ${tempDiff.toFixed(1)}°C colder than lowest controller - increased to maintain 10°C diff`
            });

          return new Response(JSON.stringify({ 
            success: true, 
            adjustments: [{
              cooler: coolerController.name,
              oldTarget: currentCoolerTarget,
              newTarget: newTarget,
              reason: `Increased - diff was ${tempDiff.toFixed(1)}°C`
            }]
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    }

    // Check if any followed controller has cooling capability
    const hasAnyCoolingCapability = followedControllersFullData.some(c => c.cooling_enabled === true);

    if (!hasAnyCoolingCapability) {
      console.log(`No followed controller has cooling enabled - setting cooler to default 18°C`);
      
      const defaultTemp = 18;
      
      // Only update if current target is different from default
      if (Math.abs(currentCoolerTarget - defaultTemp) > 0.1) {
        const coolerMinTemp = parseFloat(coolerController.min_target_temp || '-5');
        const coolerMaxTemp = parseFloat(coolerController.max_target_temp || '25');
        
        if (defaultTemp >= coolerMinTemp && defaultTemp <= coolerMaxTemp) {
          const updateResponse = await supabase.functions.invoke('rapt-update-controller', {
            body: {
              controllerId: coolerController.controller_id,
              action: 'setTargetTemperature',
              value: defaultTemp
            }
          });

          if (updateResponse.error) {
            console.error(`Failed to set cooler to default:`, updateResponse.error);
          } else {
            console.log(`Successfully set cooler to default ${defaultTemp}°C`);
            
            // Log the adjustment (no specific followed controller in this case)
            await supabase
              .from('auto_cooling_adjustments')
              .insert({
                cooler_controller_id: coolerController.controller_id,
                cooler_controller_name: coolerController.name,
                old_target_temp: currentCoolerTarget,
                new_target_temp: defaultTemp,
                lowest_followed_temp: lowestTargetTemp,
                followed_controller_id: null,
                followed_controller_name: null,
                followed_current_temp: null,
                followed_target_temp: null,
                followed_hysteresis: null,
                reason: `No controller has cooling capability - set to default 18°C`
              });

            return new Response(JSON.stringify({ 
              success: true, 
              adjustments: [{
                cooler: coolerController.name,
                oldTarget: currentCoolerTarget,
                newTarget: defaultTemp,
                reason: 'Set to default - no cooling capability'
              }]
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }
      }
      
      // Reset timer since no cooling capability
      await supabase
        .from('auto_cooling_settings')
        .update({ last_check_at: null })
        .eq('id', settings.id);

      return new Response(JSON.stringify({ 
        message: 'No cooling capability, cooler at default',
        resetTimer: true 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if lowest controller is actively cooling (pill_temp > target_temp + 0.1)
    const lowestCurrentTemp = parseFloat(lowestTempController.pill_temp ?? lowestTempController.current_temp ?? '0');
    const isActivelyCooling = lowestCurrentTemp > (lowestTargetTemp + 0.1);

    if (!isActivelyCooling) {
      console.log(`Lowest temp controller ${lowestTempController.name} is not actively cooling (current: ${lowestCurrentTemp}°C <= target: ${lowestTargetTemp}°C) - resetting timer`);
      
      // Reset timer since not actively cooling
      await supabase
        .from('auto_cooling_settings')
        .update({ last_check_at: null })
        .eq('id', settings.id);

      return new Response(JSON.stringify({ 
        message: 'Lowest controller not actively cooling',
        resetTimer: true 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Lowest temp controller ${lowestTempController.name} is actively cooling - checking if adjustment needed`);

    // Check if enough time has passed since last check
    const now = new Date();
    const checkIntervalMs = settings.check_interval_minutes * 60 * 1000;
    
    if (settings.last_check_at) {
      const lastCheckTime = new Date(settings.last_check_at);
      const timeSinceLastCheck = now.getTime() - lastCheckTime.getTime();
      
      if (timeSinceLastCheck < checkIntervalMs) {
        const remainingMinutes = Math.ceil((checkIntervalMs - timeSinceLastCheck) / 60000);
        console.log(`Not enough time has passed since last check. ${remainingMinutes} minutes remaining until next check.`);
        return new Response(JSON.stringify({ 
          message: `Wait ${remainingMinutes} more minutes`,
          minutesRemaining: remainingMinutes
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    console.log(`Interval has passed or no last_check_at - proceeding with check`);

    // Check if we have enough history data (at least 1 new reading since last check)
    const checkTime = new Date(Date.now() - settings.check_interval_minutes * 60 * 1000);
    
    const { data: history, error: historyError } = await supabase
      .from('temp_controller_history')
      .select('*')
      .eq('controller_id', lowestTempController.controller_id)
      .gte('recorded_at', checkTime.toISOString())
      .order('recorded_at', { ascending: false });

    if (historyError || !history || history.length < 2) {
      console.log(`Not enough history data for controller ${lowestTempController.name} (need at least 2 readings)`);
      return new Response(JSON.stringify({ message: 'Not enough data yet' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${history.length} history records in the last ${settings.check_interval_minutes} minutes`);

    // Check if all history records show active cooling (temp > target + 0.1)
    const allActivelyCooling = history.every(record => {
      const currentTemp = parseFloat(record.current_temp);
      const targetTemp = parseFloat(record.target_temp);
      return record.cooling_enabled === true && currentTemp > (targetTemp + 0.1);
    });
    
    if (!allActivelyCooling) {
      console.log(`Controller ${lowestTempController.name} has not been actively trying to cool for the entire interval, no adjustment needed`);
      
      // Update last_check_at since we did the check
      await supabase
        .from('auto_cooling_settings')
        .update({ last_check_at: new Date().toISOString() })
        .eq('id', settings.id);
      
      console.log('Updated last_check_at timestamp - countdown restarted');
      
      return new Response(JSON.stringify({ message: 'Not actively cooling entire period' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Controller ${lowestTempController.name} has been actively trying to cool (temp > target) for the entire interval`);
    console.log(`Time to adjust cooler temperature to help ${lowestTempController.name}`);
    
    // Update last_check_at since we're doing the adjustment
    await supabase
      .from('auto_cooling_settings')
      .update({ last_check_at: new Date().toISOString() })
      .eq('id', settings.id);
    
    console.log('Updated last_check_at timestamp - countdown restarted');

    const adjustments = [];
    const shouldAdjustCooler = true;
    const strugglingController = lowestTempController;

    if (shouldAdjustCooler && strugglingController) {
      const newTarget = currentCoolerTarget - parseFloat(settings.temp_reduction_degrees);

      // Check against lowest target temp with max diff
      let finalTarget = newTarget;
      if (lowestTargetTemp !== null) {
        const maxAllowedTarget = lowestTargetTemp - parseFloat(settings.max_diff_from_lowest);
        if (newTarget < maxAllowedTarget) {
          console.log(`Limiting cooler target to ${maxAllowedTarget}°C (lowest followed: ${lowestTargetTemp}°C - ${settings.max_diff_from_lowest}°C)`);
          finalTarget = maxAllowedTarget;
        }
      }

      // Only adjust if we're actually lowering the target
      if (finalTarget < currentCoolerTarget) {
        // Check against cooler's own min/max limits
        const coolerMinTemp = parseFloat(coolerController.min_target_temp || '-5');
        const coolerMaxTemp = parseFloat(coolerController.max_target_temp || '25');
        
        if (finalTarget < coolerMinTemp) {
          console.log(`Cannot set cooler below its minimum (${coolerMinTemp}°C), skipping adjustment`);
        } else if (finalTarget > coolerMaxTemp) {
          console.log(`Cannot set cooler above its maximum (${coolerMaxTemp}°C), skipping adjustment`);
        } else {
          console.log(`Adjusting cooler from ${currentCoolerTarget}°C to ${finalTarget}°C due to ${strugglingController.name} struggling to cool`);
          
          // Call the update controller function for the COOLER
          const updateResponse = await supabase.functions.invoke('rapt-update-controller', {
            body: {
              controllerId: coolerController.controller_id,
              action: 'setTargetTemperature',
              value: finalTarget
            }
          });

          if (updateResponse.error) {
            console.error(`Failed to update cooler controller ${coolerController.name}:`, updateResponse.error);
          } else {
            console.log(`Successfully updated cooler controller ${coolerController.name}`);
            adjustments.push({
              cooler: coolerController.name,
              oldTarget: currentCoolerTarget,
              newTarget: finalTarget,
              reason: `Followed controller ${strugglingController.name} struggling to cool`
            });

            // Log the adjustment to database
            const lowestFollowedTemp = followedControllersFullData
              .map(c => parseFloat(c.pill_temp || c.current_temp || '999'))
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
                followed_current_temp: parseFloat(strugglingController.pill_temp ?? strugglingController.current_temp ?? '0'),
                followed_target_temp: parseFloat(strugglingController.target_temp || '0'),
                followed_hysteresis: parseFloat(strugglingController.cooling_hysteresis ?? '0.2'),
                reason: `${strugglingController.name} struggling to cool`
              });

            if (logError) {
              console.error('Failed to log adjustment:', logError);
            } else {
              console.log('Adjustment logged to database');
            }
          }
        }
      } else {
        console.log('Cooler target would not be lowered, skipping adjustment');
      }
    } else {
      console.log('No followed controllers struggling to cool, no adjustment needed');
    }

    console.log(`\nCompleted auto adjustment check. Made ${adjustments.length} adjustments.`);

    return new Response(JSON.stringify({ 
      success: true, 
      adjustments,
      message: `Made ${adjustments.length} adjustments`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in auto-adjust-cooling function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
