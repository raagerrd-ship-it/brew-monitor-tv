import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.58.0'
import { createBrewSnapshots } from '../_shared/brew-snapshots.ts'
import { applySgCorrection, getLearnedResidual } from '../_shared/sg-temp-correction.ts'

// ── Inlined RAPT auth (shared across sub-functions) ──
async function getRaptToken(): Promise<string> {
  const RAPT_USERNAME = Deno.env.get('RAPT_USERNAME');
  const RAPT_API_SECRET = Deno.env.get('RAPT_API_SECRET');
  if (!RAPT_USERNAME || !RAPT_API_SECRET) throw new Error('RAPT credentials not configured');

  const formData = new URLSearchParams();
  formData.append('client_id', 'rapt-user');
  formData.append('grant_type', 'password');
  formData.append('username', RAPT_USERNAME);
  formData.append('password', RAPT_API_SECRET);

  const authBaseUrl = Deno.env.get('RAPT_AUTH_BASE_URL') || 'https://id.rapt.io';
  const res = await fetch(`${authBaseUrl}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`RAPT auth error: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

// ── Inlined Brewfather readings fetch — returns SG-corrected values ──
async function fetchBrewfatherReadings(batchId: string, _sgCorrectionEnabled: boolean): Promise<any[]> {
  const BREWFATHER_USER_ID = Deno.env.get('BREWFATHER_USER_ID');
  const BREWFATHER_API_KEY = Deno.env.get('BREWFATHER_API_KEY');
  if (!BREWFATHER_USER_ID || !BREWFATHER_API_KEY) throw new Error('Brewfather credentials not configured');

  const res = await fetch(
    `https://api.brewfather.app/v2/batches/${encodeURIComponent(batchId)}/readings`,
    {
      headers: { 'Authorization': `Basic ${btoa(`${BREWFATHER_USER_ID}:${BREWFATHER_API_KEY}`)}` },
      signal: AbortSignal.timeout(15000),
    }
  );
  if (!res.ok) throw new Error(`Brewfather API error: ${res.status}`);
  // SG correction is NOT applied here — RAPT pills already compensate internally.
  // The per-pill residual correction is applied in the RAPT sync pipeline instead.
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    console.log('Starting FULL sync (Brewfather + RAPT discovery + quick sync + AI audit)...')

    // Single sync_settings + auto_cooling_settings query
    const [{ data: syncSettings }, { data: autoCoolingRow }] = await Promise.all([
      supabase.from('sync_settings')
        .select('id, auto_hide_completed, auto_hide_conditioning, auto_activate_fermenting, auto_hide_archived, brewfather_enabled')
        .limit(1).single(),
      supabase.from('auto_cooling_settings')
        .select('sg_temp_correction_enabled').limit(1).maybeSingle(),
    ]);
    const sgTempCorrectionEnabled = (autoCoolingRow as any)?.sg_temp_correction_enabled ?? false;

    // Update timestamps (fire-and-forget)
    if (syncSettings?.id) {
      const nowIso = new Date().toISOString()
      supabase.from('sync_settings').update({
        last_sync_time: nowIso,
        last_full_sync_at: nowIso
      }).eq('id', syncSettings.id).then(({ error }) => {
        if (error) console.error('sync_settings update error:', error)
      })
    }

    const autoHideCompleted = syncSettings?.auto_hide_completed ?? true
    const autoHideConditioning = syncSettings?.auto_hide_conditioning ?? true
    const autoActivateFermenting = syncSettings?.auto_activate_fermenting ?? true
    const autoHideArchived = syncSettings?.auto_hide_archived ?? true
    const brewfatherEnabled = (syncSettings as any)?.brewfather_enabled ?? true

    // ──────────────────────────────────────────────────────
    // STEP 1: Brewfather full batch sync + auto-manage
    // ──────────────────────────────────────────────────────

    let batchesData: any[] = []
    if (brewfatherEnabled) {
      try {
        // Single fetch with complete=true (used for both auto-manage AND detail sync)
        const { data, error: batchesError } = await supabase.functions.invoke('brewfather-batches', {
          body: { complete: true }
        })
        if (batchesError) console.error('Error fetching batches:', batchesError)
        else batchesData = data || []
      } catch (e) {
        console.error('Failed to fetch Brewfather batches:', e)
      }
      console.log(`Fetched ${batchesData.length} batches from Brewfather`)
    } else {
      console.log('Brewfather disabled, skipping batch sync')
    }

    // Auto-manage selected_brews
    let existingBrewsArr: any[] = []
    const toShow: string[] = []
    const toHide: string[] = []
    const toInsert: { batch_id: string; display_order: number; is_visible: boolean }[] = []

    if (batchesData.length > 0) {
      const fermentingBatches = batchesData
        .filter((b: any) => b.status === 'Fermenting')
        .sort((a: any, b: any) => new Date(b.brewDate || 0).getTime() - new Date(a.brewDate || 0).getTime())
      const top3FermentingIds = fermentingBatches.slice(0, 3).map((b: any) => b._id)

      const allBatchIds = batchesData.map((b: any) => b._id)
      const { data: ebArr } = await supabase
        .from('selected_brews').select('*').in('batch_id', allBatchIds)
      existingBrewsArr = ebArr || []
      const existingBrewsMap = new Map(existingBrewsArr.map(b => [b.batch_id, b]))

      const { data: maxOrder } = await supabase.from('selected_brews')
        .select('display_order').order('display_order', { ascending: false }).limit(1).maybeSingle()
      let nextOrder = (maxOrder?.display_order || 0) + 1

      for (const batch of batchesData) {
        const isFermenting = batch.status === 'Fermenting'
        const isCompleted = batch.status === 'Completed'
        const isConditioning = batch.status === 'Conditioning'
        const isArchived = batch.status === 'Archived'
        const isInTop3 = top3FermentingIds.includes(batch._id)
        const existingBrew = existingBrewsMap.get(batch._id)

        let shouldBeVisible = false
        if (isFermenting && isInTop3 && autoActivateFermenting) {
          shouldBeVisible = true
        } else if (existingBrew) {
          shouldBeVisible = existingBrew.is_visible
          if (isCompleted && autoHideCompleted) shouldBeVisible = false
          if (isConditioning && autoHideConditioning) shouldBeVisible = false
          if (isArchived && autoHideArchived) shouldBeVisible = false
        }

        if (shouldBeVisible) {
          if (existingBrew) {
            if (!existingBrew.is_visible) toShow.push(batch._id)
          } else if (autoActivateFermenting && isFermenting && isInTop3) {
            toInsert.push({ batch_id: batch._id, display_order: nextOrder++, is_visible: true })
          }
        } else if (existingBrew?.is_visible) {
          toHide.push(batch._id)
        }
      }

      const visibilityOps: Promise<any>[] = []
      if (toShow.length > 0) visibilityOps.push(supabase.from('selected_brews').update({ is_visible: true }).in('batch_id', toShow))
      if (toHide.length > 0) visibilityOps.push(supabase.from('selected_brews').update({ is_visible: false }).in('batch_id', toHide))
      if (toInsert.length > 0) visibilityOps.push(supabase.from('selected_brews').insert(toInsert))
      if (visibilityOps.length > 0) await Promise.all(visibilityOps)
    }

    // Build visible brews list from existing state (no extra DB query needed)
    const visibleBatchIds = new Set<string>()
    if (batchesData.length > 0) {
      for (const b of existingBrewsArr) {
        if (b.is_visible && !toHide.includes(b.batch_id)) visibleBatchIds.add(b.batch_id)
      }
      for (const id of toShow) visibleBatchIds.add(id)
      for (const ins of toInsert) visibleBatchIds.add(ins.batch_id)
    } else {
      const { data: dbSelected } = await supabase
        .from('selected_brews').select('batch_id').eq('is_visible', true)
      for (const b of (dbSelected || [])) visibleBatchIds.add(b.batch_id)
    }

    let brewUpdatesCount = 0
    let pendingFullSyncSnapshots: { brewId: string; controllerId: string | null; sgData: any[] }[] = []

    if (brewfatherEnabled && visibleBatchIds.size > 0) {
      const brewfatherBatchIds = [...visibleBatchIds].filter(id => !id.startsWith('custom_'))

      if (brewfatherBatchIds.length > 0) {
        // Reuse batchesData from first fetch (eliminates Problem 4: double fetch)
        const batchesMap = new Map(batchesData.map((b: any) => [b._id, b]))
        const batchesToSync = brewfatherBatchIds
          .map(id => batchesMap.get(id))
          .filter(Boolean)

        // Fetch readings inlined (Problem 3: no more edge function hops)
        const readingsResults = await Promise.all(
          batchesToSync.map((batch: any) =>
            fetchBrewfatherReadings(batch._id, sgTempCorrectionEnabled)
              .then(readings => ({ batch, readings, error: null }))
              .catch(err => ({ batch, readings: [] as any[], error: err }))
          )
        )

        const brewUpdates = readingsResults.map(result => {
          if (result.error) { console.error(`Readings error for ${result.batch._id}:`, result.error); return null; }
          const batch = result.batch
          const readings = result.readings

          // SG values already temp-corrected at fetch time
          const sgData = readings.filter((r: any) => r.sg && r.temp)
            .map((r: any) => ({ date: new Date(r.time).toISOString(), value: r.sg, temp: r.temp }))
            .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())

          const readingsWithSG = readings.filter((r: any) => r.sg)
            .sort((a: any, b: any) => new Date(a.time).getTime() - new Date(b.time).getTime())
          const latestReading = readingsWithSG.length > 0 ? readingsWithSG[readingsWithSG.length - 1] : null
          const currentSG = latestReading?.sg || batch.measuredOg || batch.estimatedOg || 1.050
          const currentTemp = latestReading?.temp || 20
          const battery = latestReading?.battery ? Math.round(latestReading.battery) : null
          const og = batch.measuredOg || batch.estimatedOg || 1.050
          const fg = batch.measuredFg || batch.estimatedFg || 1.010
          const attenuation = ((og - currentSG) / (og - 1.000)) * 100
          const abv = ((og - currentSG) * 131.25) || batch.estimatedAbv || 0

          return {
            batch_id: batch._id,
            name: batch.recipe?.name || batch.name,
            style: batch.recipe?.style?.name || 'Okänd stil',
            batch_number: `#${batch.batchNo}`,
            status: batch.status === 'Conditioning' ? 'Konditionering' : 
                    batch.status === 'Completed' ? 'Klar' : 
                    batch.status === 'Fermenting' ? 'Jäsning' : batch.status,
            current_sg: currentSG, current_temp: currentTemp,
            attenuation: Math.round(attenuation), abv: parseFloat(abv.toFixed(1)),
            original_gravity: og, final_gravity: fg,
            last_update: latestReading ? new Date(latestReading.time).toISOString() : null,
            battery,
            sg_data: sgData.length > 0 ? sgData : [
              { date: 'Start', value: og, temp: 20 },
              { date: 'Nu', value: currentSG, temp: currentTemp },
            ],
          }
        }).filter(Boolean)

        if (brewUpdates.length > 0) {
          const updateBatchIds = brewUpdates.map((u: any) => u.batch_id)
          const [{ error: upsertError }, { data: brewRecords }] = await Promise.all([
            supabase.from('brew_readings').upsert(brewUpdates, { onConflict: 'batch_id' }),
            supabase.from('brew_readings').select('id, batch_id, linked_controller_id').in('batch_id', updateBatchIds),
          ])
          if (upsertError) throw upsertError
          brewUpdatesCount = brewUpdates.length

          // Collect snapshot jobs for Step 5 (after automation + history logging)
          const brewRecordsMap = new Map((brewRecords || []).map((r: any) => [r.batch_id, r]))
          for (const u of brewUpdates) {
            if (((u as any).status === 'Jäsning' || (u as any).status === 'Fermenting') && (u as any).sg_data?.length > 0) {
              const record = brewRecordsMap.get((u as any).batch_id)
              if (record) {
                pendingFullSyncSnapshots.push({
                  brewId: record.id,
                  controllerId: record.linked_controller_id,
                  sgData: (u as any).sg_data,
                })
              }
            }
          }
        }
      }
    }

    // ──────────────────────────────────────────────────────
    // STEP 2: Get RAPT token ONCE, then run discovery + quick sync
    // ──────────────────────────────────────────────────────

    let raptToken: string | null = null;
    try {
      raptToken = await getRaptToken();
    } catch (e) {
      console.error('RAPT auth failed (discovery + quick sync will use their own fallback):', e);
    }

    // STEP 2a: RAPT auto-discovery (pass token to avoid double auth)
    console.log('Running RAPT auto-discovery...')
    try {
      const raptResult = await supabase.functions.invoke('sync-rapt-data', { 
        body: raptToken ? { access_token: raptToken } : {} 
      })
      if (raptResult.error) console.error('RAPT auto-discovery error:', raptResult.error)
      else console.log('RAPT auto-discovery completed')
    } catch (e) {
      console.error('RAPT auto-discovery failed:', e)
    }

    // ──────────────────────────────────────────────────────
    // STEP 3: Quick sync (pass same token to avoid triple auth)
    // ──────────────────────────────────────────────────────

    console.log('Running quick sync pass (data + automation)...')
    try {
      await supabase.functions.invoke('sync-rapt-data-quick', { 
        body: raptToken ? { access_token: raptToken } : {} 
      })
      console.log('Quick sync pass completed')
    } catch (e) {
      console.error('Quick sync pass failed:', e)
    }

    // ──────────────────────────────────────────────────────
    // STEP 4: AI audit
    // ──────────────────────────────────────────────────────

    const { data: autoCoolingSettings } = await supabase
      .from('auto_cooling_settings').select('ai_audit_enabled').limit(1).maybeSingle()
    const aiAuditEnabled = autoCoolingSettings?.ai_audit_enabled ?? true

    if (aiAuditEnabled) {
      console.log('Running AI audit...')
      try {
        const aiResult = await supabase.functions.invoke('ai-automation-audit', { body: {} })
        if (aiResult.error) console.error('AI audit error:', aiResult.error)
        else console.log('AI audit completed')
      } catch (e) {
        console.error('AI audit failed:', e)
      }
    } else {
      console.log('AI audit disabled, skipping')
    }

    // ──────────────────────────────────────────────────────
    // STEP 5: Create brew snapshots (AFTER automation + history)
    // ──────────────────────────────────────────────────────
    if (pendingFullSyncSnapshots.length > 0) {
      console.log(`Creating ${pendingFullSyncSnapshots.length} brew snapshot(s) (post-automation)...`)
      for (const s of pendingFullSyncSnapshots) {
        await createBrewSnapshots(supabase, s.brewId, s.controllerId, s.sgData)
      }
    }

    console.log(`FULL sync completed: ${brewUpdatesCount} brews`)

    return new Response(
      JSON.stringify({ message: 'Full sync completed', count: brewUpdatesCount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error in full-sync-brew-data:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
