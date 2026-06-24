import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { applySgCorrection, getLearnedResidual } from '../_shared/sg-temp-correction.ts';
import { createBrewSnapshot } from '../_shared/brew-snapshots.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Starting custom brew pill sync (quick-append)...');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Read SG correction setting
    const { data: autoCoolingRow } = await supabase
      .from('auto_cooling_settings').select('sg_temp_correction_enabled').limit(1).maybeSingle();
    const sgTempCorrectionEnabled = (autoCoolingRow as any)?.sg_temp_correction_enabled ?? false;

    // Get custom brews that are actively fermenting
    const { data: customBrews, error: brewsError } = await supabase
      .from('brew_readings')
      .select('*')
      .like('batch_id', 'custom\\_%')
      .in('status', ['Jäsning', 'Fermenting']);

    if (brewsError) throw new Error(`Failed to fetch custom brews: ${brewsError.message}`);

    if (!customBrews || customBrews.length === 0) {
      console.log('No custom brews in fermentation found');
      return new Response(
        JSON.stringify({ success: true, message: 'No custom brews in fermentation', brewsUpdated: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${customBrews.length} custom brews in fermentation`);

    // Get passed-in data from sync-rapt-data-quick (preferred) or fall back to DB
    let allPills: any[] | null = null;
    let allControllers: any[] | null = null;
    try {
      const body = await req.json().catch(() => ({}));
      if (body?.pills && Array.isArray(body.pills)) allPills = body.pills;
      if (body?.controllers && Array.isArray(body.controllers)) allControllers = body.controllers;
    } catch { /* no body */ }

    if (!allPills || !allControllers) {
      const [{ data: dbPills }, { data: dbControllers }] = await Promise.all([
        allPills ? Promise.resolve({ data: allPills }) : supabase.from('rapt_pills').select('pill_id, name, paired_device_id, gravity, temperature, battery_level, last_update'),
        allControllers ? Promise.resolve({ data: allControllers }) : supabase.from('rapt_temp_controllers').select('controller_id, linked_pill_id, pill_temp, current_temp, target_temp, profile_target_temp, actual_temp'),
      ]);
      if (!allPills) allPills = dbPills;
      if (!allControllers) allControllers = dbControllers;
    }

    let brewsUpdated = 0;

    for (const brew of customBrews) {
      try {
        // ── Resolve pill for this brew ──
        let pillId = brew.linked_pill_id;

        if (!pillId && brew.linked_controller_id) {
          const controller = allControllers?.find(c => c.controller_id === brew.linked_controller_id);
          if (controller?.linked_pill_id) pillId = controller.linked_pill_id;
        }

        if (!pillId) {
          for (const pill of (allPills || [])) {
            if (!pill.paired_device_id) continue;
            const controller = allControllers?.find(c => c.controller_id === pill.paired_device_id);
            if (controller?.pill_temp != null && Math.abs(controller.pill_temp - brew.current_temp) <= 3) {
              pillId = pill.pill_id;
              console.log(`Auto-matched pill ${pill.name} to brew ${brew.name} via paired_device_id + temp matching`);
              break;
            }
          }
        }

        if (!pillId) {
          console.log(`No pill_id available for brew ${brew.name}, skipping`);
          continue;
        }

        // ── Get latest values from pill (already synced by sync-rapt-data-quick) ──
        const pill = allPills?.find(p => p.pill_id === pillId);
        const ctrlForBrew = allControllers?.find(c => c.controller_id === brew.linked_controller_id);

        if (!pill) {
          console.log(`Pill ${pillId} not found in data for brew ${brew.name}, skipping`);
          continue;
        }

        const rawSg = pill.gravity != null ? pill.gravity / 1000 : null;
        const pillTemp = pill.temperature;

        if (rawSg == null || rawSg < 0.990 || rawSg > 1.200) {
          console.log(`No valid SG for brew ${brew.name} (raw: ${rawSg}), using controller fallback`);
          // Controller-only fallback
          if (ctrlForBrew) {
            const fallbackTemp = ctrlForBrew.actual_temp ?? ctrlForBrew.current_temp;
            if (fallbackTemp != null) {
              await supabase.from('brew_readings')
                .update({ current_temp: fallbackTemp, updated_at: new Date().toISOString() })
                .eq('id', brew.id);
              await createBrewSnapshot(supabase, brew.id, {
                recorded_at: new Date().toISOString(),
                sg: brew.current_sg ?? 1.000,
                pill_temp: ctrlForBrew.pill_temp ?? null,
                controller_temp: ctrlForBrew.current_temp ?? null,
                profile_target_temp: ctrlForBrew.profile_target_temp ?? null,
                actual_temp: ctrlForBrew.actual_temp ?? null,
                controller_id: ctrlForBrew.controller_id ?? null,
              });
              brewsUpdated++;
            }
          }
          continue;
        }

        // ── Apply SG correction if enabled ──
        let correctedSg = rawSg;
        if (sgTempCorrectionEnabled && pillTemp != null) {
          try {
            const { residualPerDegree, confident } = await getLearnedResidual(supabase, pillId);
            if (confident) {
              correctedSg = applySgCorrection(rawSg, pillTemp, residualPerDegree);
            }
          } catch (_e) { /* no correction yet */ }
        }

        // ── Auto-set OG on first snapshot ──
        let og = brew.original_gravity;
        const { count: existingSnapshotCount } = await supabase
          .from('brew_data_snapshots')
          .select('id', { count: 'exact', head: true })
          .eq('brew_id', brew.id);
        const hasNoData = !existingSnapshotCount || existingSnapshotCount === 0;

        if (hasNoData && correctedSg >= 1.030 && correctedSg <= 1.150) {
          og = correctedSg;
          console.log(`Auto-updating OG for ${brew.name} to ${og} (initial sync)`);
        }

        // ── Compute derived values ──
        const attenuation = og > 1 ? Math.round(((og - correctedSg) / (og - 1)) * 100) : 0;
        const abv = og > 1 ? Number(((og - correctedSg) * 131.25).toFixed(1)) : 0;
        const ssotTemp = ctrlForBrew?.actual_temp ?? pillTemp;
        const now = new Date().toISOString();

        // ── Create snapshot ──
        await createBrewSnapshot(supabase, brew.id, {
          recorded_at: now,
          sg: correctedSg,
          pill_temp: pillTemp,
          controller_temp: ctrlForBrew?.current_temp ?? null,
          profile_target_temp: ctrlForBrew?.profile_target_temp ?? null,
          actual_temp: ctrlForBrew?.actual_temp ?? pillTemp,
          controller_id: ctrlForBrew?.controller_id ?? null,
        });

        // ── Update brew_readings with latest values ──
        const { error: updateError } = await supabase
          .from('brew_readings')
          .update({
            current_sg: correctedSg,
            current_temp: ssotTemp,
            original_gravity: og,
            attenuation: Math.max(0, Math.min(100, attenuation)),
            abv: Math.max(0, abv),
            battery: pill.battery_level,
            last_update: now,
            updated_at: now,
          })
          .eq('id', brew.id);

        if (updateError) {
          console.error(`Failed to update brew ${brew.name}:`, updateError);
          continue;
        }

        console.log(`Updated brew ${brew.name}: SG=${correctedSg.toFixed(4)}, temp=${ssotTemp}°C`);
        brewsUpdated++;
      } catch (brewError) {
        console.error(`Error processing brew ${brew.name}:`, brewError);
        continue;
      }
    }

    console.log(`Custom brew pill sync complete. Updated ${brewsUpdated}/${customBrews.length} brews`);

    return new Response(
      JSON.stringify({ success: true, brewsUpdated, totalBrews: customBrews.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in sync-custom-brew-pills:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
