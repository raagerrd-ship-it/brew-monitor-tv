import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Starting RAPT quick data sync...');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Update timestamp
    await supabase
      .from('sync_settings')
      .update({ last_rapt_quick_sync_at: new Date().toISOString() })
      .eq('id', (await supabase.from('sync_settings').select('id').single()).data?.id);

    console.log('Updated last_rapt_quick_sync_at timestamp');

    // Get auth token
    console.log('Getting RAPT auth token...');
    const { data: authData, error: authError } = await supabase.functions.invoke('rapt-auth');
    
    if (authError) throw authError;
    const { access_token } = authData;

    // Get selected Pills
    const { data: selectedPills } = await supabase
      .from('selected_rapt_pills')
      .select('pill_id')
      .eq('is_visible', true);

    const selectedPillIds = selectedPills?.map(p => p.pill_id) || [];

    // Get selected Controllers
    const { data: selectedControllers } = await supabase
      .from('selected_rapt_temp_controllers')
      .select('controller_id')
      .eq('is_visible', true);

    const selectedControllerIds = selectedControllers?.map(c => c.controller_id) || [];

    if (selectedPillIds.length === 0 && selectedControllerIds.length === 0) {
      console.log('No selected RAPT devices, skipping sync');
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No devices selected',
          pillsUpdated: 0,
          controllersUpdated: 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let pillsUpdated = 0;
    let controllersUpdated = 0;

    // Fetch Pills data if any selected
    if (selectedPillIds.length > 0) {
      console.log(`Fetching data for ${selectedPillIds.length} selected Pills...`);
      const { data: pillsData, error: pillsError } = await supabase.functions.invoke('rapt-pills', {
        body: { access_token }
      });

      if (pillsError) throw pillsError;

      // Filter only selected pills and update
      const selectedPillsData = pillsData.filter((pill: any) => 
        selectedPillIds.includes(pill.id)
      );

      console.log(`Updating ${selectedPillsData.length} Pills...`);

      for (const pill of selectedPillsData) {
        const battery = Math.round(pill.battery || 0);
        const lastUpdate = pill.lastActivityTime || pill.telemetry?.[0]?.createdOn;

        await supabase
          .from('rapt_pills')
          .update({
            battery_level: battery,
            last_update: lastUpdate,
            updated_at: new Date().toISOString()
          })
          .eq('pill_id', pill.id);

        pillsUpdated++;
      }

      console.log(`Successfully updated ${pillsUpdated} Pills`);
    }

    // Fetch Temperature Controllers data if any selected
    if (selectedControllerIds.length > 0) {
      console.log(`Fetching data for ${selectedControllerIds.length} selected Temperature Controllers...`);
      const { data: controllersData, error: controllersError } = await supabase.functions.invoke('rapt-temp-controllers', {
        body: { access_token }
      });

      if (controllersError) throw controllersError;

      // Get active fermentation sessions to avoid overwriting their target temps
      const { data: activeSessions } = await supabase
        .from('fermentation_sessions')
        .select('controller_id')
        .in('status', ['running', 'paused']);
      
      const controllersWithActiveSessions = new Set(
        activeSessions?.map(s => s.controller_id) || []
      );

      // Get cooler controller to avoid overwriting its target temp (managed by auto-cooling)
      const { data: autoCoolingSettings } = await supabase
        .from('auto_cooling_settings')
        .select('cooler_controller_id, enabled')
        .single();
      
      const coolerControllerId = autoCoolingSettings?.enabled ? autoCoolingSettings?.cooler_controller_id : null;

      // Filter only selected controllers and update
      const selectedControllersData = controllersData.filter((controller: any) => 
        selectedControllerIds.includes(controller.id)
      );

      console.log(`Updating ${selectedControllersData.length} Temperature Controllers...`);

      for (const controller of selectedControllersData) {
        const currentTemp = controller.temperature || controller.telemetry?.[0]?.temperature;
        const pillTemp = controller.controlDeviceTemperature || null;
        const targetTemp = controller.targetTemperature;
        const lastUpdate = controller.lastActivityTime || controller.telemetry?.[0]?.createdOn;
        
        // Check if this controller has an active fermentation session
        const hasActiveSession = controllersWithActiveSessions.has(controller.id);
        
        // Check if this is the cooler controller (managed by auto-cooling)
        const isCoolerController = controller.id === coolerControllerId;

        // Build update object - skip target_temp if controller is managed by fermentation profile or auto-cooling
        const updateData: Record<string, any> = {
          current_temp: currentTemp,
          pill_temp: pillTemp,
          cooling_enabled: controller.coolingEnabled || false,
          heating_enabled: controller.heatingEnabled || false,
          heating_utilisation: controller.heatingUtilisation || 0,
          cooling_hysteresis: controller.coolingHysteresis ?? 0.2,
          heating_hysteresis: controller.heatingHysteresis ?? 0.2,
          last_update: lastUpdate,
          updated_at: new Date().toISOString()
        };

        // Only update target_temp if NOT managed by a fermentation profile AND NOT the cooler
        if (!hasActiveSession && !isCoolerController) {
          updateData.target_temp = targetTemp;
        } else {
          const reason = hasActiveSession ? 'fermentation profile' : 'auto-cooling';
          console.log(`Skipping target_temp update for controller ${controller.id} - managed by ${reason}`);
        }

        await supabase
          .from('rapt_temp_controllers')
          .update(updateData)
          .eq('controller_id', controller.id);

        controllersUpdated++;
      }

      console.log(`Successfully updated ${controllersUpdated} Temperature Controllers`);
    }

    // Record temperature history for auto-cooling adjustment
    try {
      console.log('Recording temperature history...');
      await supabase.functions.invoke('record-temp-history');
    } catch (historyError) {
      console.error('Error recording temperature history:', historyError);
      // Don't fail the main sync if history recording fails
    }

    // Sync custom brews with linked RAPT Pills
    let customBrewsUpdated = 0;
    try {
      console.log('Syncing custom brews with linked RAPT Pills...');
      const { data: customBrewResult, error: customBrewError } = await supabase.functions.invoke('sync-custom-brew-pills');
      
      if (customBrewError) {
        console.error('Error syncing custom brews:', customBrewError);
      } else {
        customBrewsUpdated = customBrewResult?.brewsUpdated || 0;
        console.log(`Custom brew sync complete: ${customBrewsUpdated} brews updated`);
      }
    } catch (customBrewSyncError) {
      console.error('Error syncing custom brews:', customBrewSyncError);
      // Don't fail the main sync if custom brew sync fails
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        pillsUpdated,
        controllersUpdated,
        customBrewsUpdated
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in sync-rapt-data-quick:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
