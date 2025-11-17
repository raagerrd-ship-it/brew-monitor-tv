import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

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

    // Get visible controllers
    const { data: selectedControllers, error: selectedError } = await supabase
      .from('selected_rapt_temp_controllers')
      .select('controller_id')
      .eq('is_visible', true);

    if (selectedError || !selectedControllers || selectedControllers.length === 0) {
      console.log('No visible controllers found');
      return new Response(JSON.stringify({ message: 'No visible controllers' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const visibleControllerIds = selectedControllers.map(c => c.controller_id);
    console.log('Checking controllers:', visibleControllerIds);

    // Get current controller data
    const { data: controllers, error: controllersError } = await supabase
      .from('rapt_temp_controllers')
      .select('*')
      .in('controller_id', visibleControllerIds)
      .eq('cooling_enabled', true);

    if (controllersError || !controllers || controllers.length === 0) {
      console.log('No controllers with cooling enabled found');
      return new Response(JSON.stringify({ message: 'No cooling controllers' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${controllers.length} controllers with cooling enabled`);

    // Find the lowest target temperature among visible controllers
    const { data: allVisibleControllers } = await supabase
      .from('rapt_temp_controllers')
      .select('target_temp')
      .in('controller_id', visibleControllerIds);

    const lowestTargetTemp = allVisibleControllers && allVisibleControllers.length > 0
      ? Math.min(...allVisibleControllers.map(c => parseFloat(c.target_temp || '999')))
      : null;

    console.log('Lowest target temp among visible controllers:', lowestTargetTemp);

    const adjustments = [];
    const checkTime = new Date(Date.now() - settings.check_interval_minutes * 60 * 1000);

    for (const controller of controllers) {
      console.log(`\nChecking controller: ${controller.name} (${controller.controller_id})`);
      console.log(`Current: ${controller.current_temp}°C, Target: ${controller.target_temp}°C`);

      // Get temperature history for this controller
      const { data: history, error: historyError } = await supabase
        .from('temp_controller_history')
        .select('*')
        .eq('controller_id', controller.controller_id)
        .gte('recorded_at', checkTime.toISOString())
        .order('recorded_at', { ascending: false });

      if (historyError || !history || history.length === 0) {
        console.log(`No history data for controller ${controller.name}`);
        continue;
      }

      console.log(`Found ${history.length} history records in the last ${settings.check_interval_minutes} minutes`);

      // Check if temperature has been stagnant
      const oldestRecord = history[history.length - 1];
      const newestRecord = history[0];
      const tempDiff = Math.abs(parseFloat(newestRecord.current_temp) - parseFloat(oldestRecord.current_temp));

      console.log(`Temp diff over period: ${tempDiff.toFixed(2)}°C`);

      // If temperature hasn't changed more than 0.5°C and cooling is enabled
      if (tempDiff < 0.5 && controller.cooling_enabled) {
        const currentTemp = parseFloat(controller.current_temp || '0');
        const currentTarget = parseFloat(controller.target_temp || '0');
        const newTarget = currentTarget - parseFloat(settings.temp_reduction_degrees);

        // Check against lowest target temp with max diff
        let finalTarget = newTarget;
        if (lowestTargetTemp !== null) {
          const maxAllowedTarget = lowestTargetTemp - parseFloat(settings.max_diff_from_lowest);
          if (newTarget < maxAllowedTarget) {
            console.log(`Limiting target to ${maxAllowedTarget}°C (lowest: ${lowestTargetTemp}°C - ${settings.max_diff_from_lowest}°C)`);
            finalTarget = maxAllowedTarget;
          }
        }

        // Only adjust if we're actually lowering the target
        if (finalTarget < currentTarget) {
          console.log(`Temperature stagnant. Adjusting target from ${currentTarget}°C to ${finalTarget}°C`);
          
          // Call the update controller function
          const updateResponse = await supabase.functions.invoke('rapt-update-controller', {
            body: {
              controllerId: controller.controller_id,
              action: 'setTargetTemperature',
              value: finalTarget
            }
          });

          if (updateResponse.error) {
            console.error(`Failed to update controller ${controller.name}:`, updateResponse.error);
          } else {
            console.log(`Successfully updated controller ${controller.name}`);
            adjustments.push({
              controller: controller.name,
              oldTarget: currentTarget,
              newTarget: finalTarget,
              reason: 'Temperature stagnant'
            });
          }
        } else {
          console.log('Target would not be lowered, skipping adjustment');
        }
      } else {
        console.log('Temperature is changing, no adjustment needed');
      }
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
