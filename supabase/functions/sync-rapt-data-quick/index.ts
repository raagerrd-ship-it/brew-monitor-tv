import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { createBrewSnapshots } from '../_shared/brew-snapshots.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Starting unified quick sync (RAPT + Brewfather readings)...');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Update timestamp
    await supabase
      .from('sync_settings')
      .update({ 
        last_rapt_quick_sync_at: new Date().toISOString(),
        last_sync_time: new Date().toISOString()
      })
      .eq('id', (await supabase.from('sync_settings').select('id').single()).data?.id);

    // ──────────────────────────────────────────────────────
    // PHASE 1: RAPT device sync (pills + controllers)
    // ──────────────────────────────────────────────────────

    // Get auth token
    console.log('Getting RAPT auth token...');
    const { data: authData, error: authError } = await supabase.functions.invoke('rapt-auth');
    
    if (authError) throw authError;
    const { access_token } = authData;

    // Get selected Pills & Controllers
    const [{ data: selectedPills }, { data: selectedControllers }] = await Promise.all([
      supabase.from('selected_rapt_pills').select('pill_id').eq('is_visible', true),
      supabase.from('selected_rapt_temp_controllers').select('controller_id').eq('is_visible', true),
    ]);

    const selectedPillIds = selectedPills?.map(p => p.pill_id) || [];
    const selectedControllerIds = selectedControllers?.map(c => c.controller_id) || [];

    // Fetch ALL Pills and Controllers in parallel
    const [pillsResult, controllersResult] = await Promise.all([
      selectedPillIds.length > 0 
        ? supabase.functions.invoke('rapt-pills', { body: { access_token } })
        : { data: [], error: null },
      selectedControllerIds.length > 0
        ? supabase.functions.invoke('rapt-temp-controllers', { body: { access_token } })
        : { data: [], error: null },
    ]);

    if (pillsResult.error) console.error('Error fetching pills:', pillsResult.error);
    if (controllersResult.error) console.error('Error fetching controllers:', controllersResult.error);

    const allPills: any[] = pillsResult.error ? [] : (pillsResult.data || []);
    const allControllers: any[] = controllersResult.error ? [] : (controllersResult.data || []);

    // Build pill temperature map
    const pillTempMap = new Map<string, number>();
    const pillDataMap = new Map<string, any>();

    for (const pill of allPills) {
      pillDataMap.set(pill.id, pill);
      const temp = pill.temperature ?? pill.telemetry?.[0]?.temperature;
      if (temp !== undefined && temp !== null && temp !== 0) {
        pillTempMap.set(pill.id, temp);
      }
    }

    let pillsUpdated = 0;
    let controllersUpdated = 0;

    // Update Pills
    if (selectedPillIds.length > 0) {
      const selectedPillsData = allPills.filter((pill: any) => selectedPillIds.includes(pill.id));
      for (const pill of selectedPillsData) {
        await supabase.from('rapt_pills').update({
          battery_level: Math.round(pill.battery || 0),
          last_update: pill.lastActivityTime || pill.telemetry?.[0]?.createdOn,
          paired_device_id: pill.pairedDeviceId || null,
          updated_at: new Date().toISOString()
        }).eq('pill_id', pill.id);
        pillsUpdated++;
      }
    }

    // Update Controllers with enriched pill_temp
    if (selectedControllerIds.length > 0) {
      const { data: activeSessions } = await supabase.from('fermentation_sessions')
        .select('controller_id').in('status', ['running', 'paused']);
      const controllersWithActiveSessions = new Set(activeSessions?.map(s => s.controller_id) || []);

      const { data: autoCoolingSettings } = await supabase.from('auto_cooling_settings')
        .select('cooler_controller_id, enabled').single();
      const coolerControllerId = autoCoolingSettings?.enabled ? autoCoolingSettings?.cooler_controller_id : null;

      const selectedControllersData = allControllers.filter((c: any) => selectedControllerIds.includes(c.id));

      const { data: existingControllers } = await supabase.from('rapt_temp_controllers')
        .select('controller_id, linked_pill_id, target_temp')
        .in('controller_id', selectedControllersData.map((c: any) => c.id));
      const existingMap = new Map((existingControllers || []).map(c => [c.controller_id, c]));

      const controllerUpdates: Record<string, any>[] = [];

      for (const controller of selectedControllersData) {
        const currentTemp = controller.temperature || controller.telemetry?.[0]?.temperature;
        const targetTemp = controller.targetTemperature;
        const lastUpdate = controller.lastActivityTime || controller.telemetry?.[0]?.createdOn;

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
            if (apiPillTemp && apiPillTemp !== 0) pillTemp = apiPillTemp;
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

        if (linkedPillId) updateData.linked_pill_id = linkedPillId;
        if (!hasActiveSession && !isCoolerController) {
          updateData.target_temp = targetTemp;
        } else {
          updateData.target_temp = existingMap.get(controller.id)?.target_temp ?? targetTemp;
        }

        controllerUpdates.push(updateData);
        controllersUpdated++;
      }

      if (controllerUpdates.length > 0) {
        const { error: upsertError } = await supabase.from('rapt_temp_controllers')
          .upsert(controllerUpdates, { onConflict: 'controller_id', ignoreDuplicates: false });
        if (upsertError) throw upsertError;
      }
    }

    console.log(`RAPT sync: ${pillsUpdated} pills, ${controllersUpdated} controllers`);

    // ──────────────────────────────────────────────────────
    // PHASE 2: Brewfather readings (quick) + automation
    //          Run in parallel with temp history & custom brews
    // ──────────────────────────────────────────────────────

    // Fetch visible Brewfather brews
    const { data: selectedBrews } = await supabase.from('selected_brews')
      .select('batch_id').eq('is_visible', true).not('batch_id', 'like', 'custom\\_%');

    let brewsUpdated = 0;

    const brewfatherSync = async () => {
      if (!selectedBrews || selectedBrews.length === 0) return;

      // Fetch readings + existing data in parallel
      const [readingsResults, existingBrews] = await Promise.all([
        Promise.all(selectedBrews.map(brew =>
          supabase.functions.invoke('brewfather-readings', { body: { batchId: brew.batch_id } })
            .then(r => ({ batchId: brew.batch_id, data: r.data, error: r.error }))
        )),
        Promise.all(selectedBrews.map(brew =>
          supabase.from('brew_readings')
            .select('batch_id, original_gravity, final_gravity, style, name, status, batch_number, sg_data, current_sg, current_temp, attenuation, abv, last_update, battery')
            .eq('batch_id', brew.batch_id).maybeSingle()
            .then(r => ({ batchId: brew.batch_id, data: r.data }))
        ))
      ]);

      const existingBrewsMap = new Map(existingBrews.map(b => [b.batchId, b.data]));

      const brewUpdates = readingsResults.map(result => {
        if (result.error) { console.error(`Readings error for ${result.batchId}:`, result.error); return null; }
        const readings = result.data || [];
        const existingBrew = existingBrewsMap.get(result.batchId);

        const sgData = readings.filter((r: any) => r.sg && r.temp)
          .map((r: any) => ({ date: new Date(r.time).toISOString(), value: r.sg, temp: r.temp }))
          .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

        const readingsWithSG = readings.filter((r: any) => r.sg)
          .sort((a: any, b: any) => new Date(a.time).getTime() - new Date(b.time).getTime());
        const latestReading = readingsWithSG.length > 0 ? readingsWithSG[readingsWithSG.length - 1] : null;
        const currentSG = latestReading?.sg || existingBrew?.original_gravity || 1.050;
        const currentTemp = latestReading?.temp || 20;
        const battery = latestReading?.battery ? Math.round(latestReading.battery) : null;
        const og = existingBrew?.original_gravity || 1.050;

        const attenuation = ((og - currentSG) / (og - 1.000)) * 100;
        const abv = ((og - currentSG) * 131.25) || 0;

        const newData: any = {
          batch_id: result.batchId,
          current_sg: currentSG, current_temp: currentTemp,
          attenuation: Math.round(attenuation), abv: parseFloat(abv.toFixed(1)),
          last_update: latestReading ? new Date(latestReading.time).toISOString() : null,
          battery, sg_data: sgData.length > 0 ? sgData : existingBrew?.sg_data || [],
          ...(existingBrew && {
            name: existingBrew.name, style: existingBrew.style, status: existingBrew.status,
            batch_number: existingBrew.batch_number, original_gravity: existingBrew.original_gravity,
            final_gravity: existingBrew.final_gravity
          })
        };

        if (existingBrew) {
          const hasChanged = existingBrew.current_sg !== newData.current_sg ||
            existingBrew.current_temp !== newData.current_temp ||
            existingBrew.last_update !== newData.last_update ||
            JSON.stringify(existingBrew.sg_data) !== JSON.stringify(newData.sg_data);
          if (!hasChanged) return null;
        }
        return newData;
      }).filter(Boolean);

      if (brewUpdates.length > 0) {
        const { error: upsertError } = await supabase.from('brew_readings')
          .upsert(brewUpdates, { onConflict: 'batch_id' });
        if (upsertError) throw upsertError;
        brewsUpdated = brewUpdates.length;
        console.log(`Brewfather quick sync: ${brewsUpdated} brews updated`);

        // Create snapshots for fermenting brews
        for (const update of brewUpdates) {
          const u = update as any;
          const status = u.status || '';
          const isFermenting = status === 'Jäsning' || status === 'Fermenting';
          if (isFermenting && u.sg_data?.length > 0) {
            const { data: brewRecord } = await supabase.from('brew_readings')
              .select('id, linked_controller_id').eq('batch_id', u.batch_id).single();
            if (brewRecord) {
              await createBrewSnapshots(supabase, brewRecord.id, brewRecord.linked_controller_id, u.sg_data);
            }
          }
        }
      }
    };

    // Run Brewfather sync, temp history, custom brews, and automation in parallel
    const [bfResult, historyResult, customBrewResult, autoResult] = await Promise.allSettled([
      brewfatherSync(),
      supabase.functions.invoke('record-temp-history'),
      supabase.functions.invoke('sync-custom-brew-pills'),
      supabase.functions.invoke('run-automation'),
    ]);

    if (bfResult.status === 'rejected') console.error('Brewfather sync error:', bfResult.reason);
    if (historyResult.status === 'rejected') console.error('Temp history error:', historyResult.reason);
    if (customBrewResult.status === 'rejected') console.error('Custom brew sync error:', customBrewResult.reason);
    if (autoResult.status === 'rejected') console.error('Automation error:', autoResult.reason);

    const customBrewsUpdated = customBrewResult.status === 'fulfilled' && !customBrewResult.value?.error
      ? customBrewResult.value?.data?.brewsUpdated || 0 : 0;
    const automationResult = autoResult.status === 'fulfilled' && !autoResult.value?.error
      ? autoResult.value?.data : null;

    // ── RAPT outage detection ──
    try {
      const { data: syncSettings } = await supabase.from('sync_settings')
        .select('id, last_successful_rapt_sync_at, rapt_sync_interval').single();
      const lastSuccess = syncSettings?.last_successful_rapt_sync_at;
      const now = new Date();
      if (lastSuccess) {
        const gap = (now.getTime() - new Date(lastSuccess).getTime()) / 1000;
        const threshold = (syncSettings?.rapt_sync_interval || 300) * 2;
        if (gap > threshold) {
          await supabase.from('rapt_outage_log').insert({
            outage_start: lastSuccess, outage_end: now.toISOString(), duration_seconds: Math.round(gap)
          });
        }
      }
      if (syncSettings?.id) {
        await supabase.from('sync_settings').update({ last_successful_rapt_sync_at: now.toISOString() }).eq('id', syncSettings.id);
      }
    } catch (e) { console.error('Outage log error:', e); }

    console.log(`Unified quick sync complete: ${pillsUpdated} pills, ${controllersUpdated} controllers, ${brewsUpdated} brews, ${customBrewsUpdated} custom brews`);

    return new Response(
      JSON.stringify({ success: true, pillsUpdated, controllersUpdated, brewsUpdated, customBrewsUpdated, automation: automationResult }),
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
