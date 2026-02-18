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

    // ---- Fetch ALL Pills and Controllers in parallel ----
    const [pillsResult, controllersResult] = await Promise.all([
      selectedPillIds.length > 0 
        ? supabase.functions.invoke('rapt-pills', { body: { access_token } })
        : { data: [], error: null },
      selectedControllerIds.length > 0
        ? supabase.functions.invoke('rapt-temp-controllers', { body: { access_token } })
        : { data: [], error: null },
    ]);

    if (pillsResult.error) throw pillsResult.error;
    if (controllersResult.error) throw controllersResult.error;

    const allPills: any[] = pillsResult.data || [];
    const allControllers: any[] = controllersResult.data || [];

    // ---- Build pill temperature map from pill data ----
    // pill.temperature holds the latest reading from the hydrometer
    const pillTempMap = new Map<string, number>();
    const pillDataMap = new Map<string, any>();

    for (const pill of allPills) {
      pillDataMap.set(pill.id, pill);
      // Use pill.temperature first, fallback to latest telemetry point
      const temp = pill.temperature ?? pill.telemetry?.[0]?.temperature;
      if (temp !== undefined && temp !== null && temp !== 0) {
        pillTempMap.set(pill.id, temp);
        console.log(`Pill temp map: ${pill.name} (${pill.id}) -> ${temp}°C`);
      }
    }

    let pillsUpdated = 0;
    let controllersUpdated = 0;

    // ---- Update Pills ----
    if (selectedPillIds.length > 0) {
      const selectedPillsData = allPills.filter((pill: any) => selectedPillIds.includes(pill.id));
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

    // ---- Update Controllers with enriched pill_temp ----
    if (selectedControllerIds.length > 0) {
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

      // Filter only selected controllers
      const selectedControllersData = allControllers.filter((controller: any) => 
        selectedControllerIds.includes(controller.id)
      );

      console.log(`Updating ${selectedControllersData.length} Temperature Controllers...`);

      // Pre-fetch existing controller data (linked_pill_id + target_temp) in one query
      const { data: existingControllers } = await supabase
        .from('rapt_temp_controllers')
        .select('controller_id, linked_pill_id, target_temp')
        .in('controller_id', selectedControllersData.map((c: any) => c.id));
      
      const existingMap = new Map(
        (existingControllers || []).map(c => [c.controller_id, c])
      );

      // Build all update records first, then batch upsert once
      const controllerUpdates: Record<string, any>[] = [];

      for (const controller of selectedControllersData) {
        const currentTemp = controller.temperature || controller.telemetry?.[0]?.temperature;
        const targetTemp = controller.targetTemperature;
        const lastUpdate = controller.lastActivityTime || controller.telemetry?.[0]?.createdOn;
        
        // ---- Enrich pill_temp from pill data ----
        let pillTemp: number | null = null;
        let linkedPillId: string | null = null;

        const apiLinkedPillId = controller.controlDeviceId || controller.linkedDevice || controller.linkedDeviceId || null;
        
        if (apiLinkedPillId && pillTempMap.has(apiLinkedPillId)) {
          pillTemp = pillTempMap.get(apiLinkedPillId)!;
          linkedPillId = apiLinkedPillId;
        } else {
          const dbLinkedPillId = existingMap.get(controller.id)?.linked_pill_id;
          if (dbLinkedPillId && pillTempMap.has(dbLinkedPillId)) {
            pillTemp = pillTempMap.get(dbLinkedPillId)!;
            linkedPillId = dbLinkedPillId;
          } else {
            const apiPillTemp = controller.controlDeviceTemperature;
            if (apiPillTemp && apiPillTemp !== 0) {
              pillTemp = apiPillTemp;
            }
          }
        }

        const hasActiveSession = controllersWithActiveSessions.has(controller.id);
        const isCoolerController = controller.id === coolerControllerId;

        const updateData: Record<string, any> = {
          controller_id: controller.id,
          name: controller.name || controller.id,
          current_temp: currentTemp,
          pill_temp: pillTemp,
          cooling_enabled: controller.coolingEnabled || false,
          heating_enabled: controller.heatingEnabled || false,
          heating_utilisation: controller.heatingUtilisation || 0,
          cooling_hysteresis: controller.coolingHysteresis ?? 0.2,
          heating_hysteresis: controller.heatingHysteresis ?? 0.2,
          cooling_run_time: controller.coolingRunTime || 0,
          cooling_starts: controller.coolingStarts || 0,
          heating_run_time: controller.heatingRunTime || 0,
          heating_starts: controller.heatingStarts || 0,
          last_update: lastUpdate,
          updated_at: new Date().toISOString()
        };

        if (linkedPillId) {
          updateData.linked_pill_id = linkedPillId;
        }

        // For managed controllers, preserve existing target_temp from DB
        if (!hasActiveSession && !isCoolerController) {
          updateData.target_temp = targetTemp;
        } else {
          // Keep the DB value so upsert doesn't overwrite with NULL
          updateData.target_temp = existingMap.get(controller.id)?.target_temp ?? targetTemp;
          const reason = hasActiveSession ? 'fermentation profile' : 'auto-cooling';
          console.log(`Preserving target_temp for ${controller.id} - managed by ${reason}`);
        }

        controllerUpdates.push(updateData);
        controllersUpdated++;
      }

      // Single batch upsert — triggers FOR EACH STATEMENT only once
      if (controllerUpdates.length > 0) {
        const { error: upsertError } = await supabase
          .from('rapt_temp_controllers')
          .upsert(controllerUpdates, { onConflict: 'controller_id', ignoreDuplicates: false });
        
        if (upsertError) {
          console.error('Error batch upserting controllers:', upsertError);
          throw upsertError;
        }
      }

      console.log(`Successfully updated ${controllersUpdated} Temperature Controllers (batch upsert)`);
    }

    // Record temperature history for auto-cooling adjustment
    try {
      console.log('Recording temperature history...');
      await supabase.functions.invoke('record-temp-history');
    } catch (historyError) {
      console.error('Error recording temperature history:', historyError);
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
