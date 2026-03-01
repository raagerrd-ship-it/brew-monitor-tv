import { createClient } from 'npm:@supabase/supabase-js@2.58.0'
import { createBrewSnapshots } from '../_shared/brew-snapshots.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    console.log('Starting FULL sync (Brewfather + RAPT + AI audit)...')

    // Single sync_settings query (merged: id + timestamps + auto-management flags)
    const { data: syncSettings } = await supabase
      .from('sync_settings')
      .select('id, auto_hide_completed, auto_hide_conditioning, auto_activate_fermenting, auto_hide_archived, brewfather_enabled')
      .limit(1).single()

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
    //         (skipped entirely when Brewfather is disabled)
    // ──────────────────────────────────────────────────────

    let batchesData: any[] = []
    if (brewfatherEnabled) {
      try {
        const { data, error: batchesError } = await supabase.functions.invoke('brewfather-batches', { body: {} })
        if (batchesError) console.error('Error fetching batches:', batchesError)
        else batchesData = data || []
      } catch (e) {
        console.error('Failed to fetch Brewfather batches:', e)
      }
      console.log(`Fetched ${batchesData.length} batches from Brewfather`)
    } else {
      console.log('Brewfather disabled, skipping batch sync')
    }

    // Auto-manage selected_brews — batch-fetch all existing brews at once (replaces N sequential queries)
    if (batchesData.length > 0) {
      const fermentingBatches = batchesData
        .filter((b: any) => b.status === 'Fermenting')
        .sort((a: any, b: any) => new Date(b.brewDate || 0).getTime() - new Date(a.brewDate || 0).getTime())
      const top3FermentingIds = fermentingBatches.slice(0, 3).map((b: any) => b._id)

      const allBatchIds = batchesData.map((b: any) => b._id)
      const { data: existingBrewsArr } = await supabase
        .from('selected_brews').select('*').in('batch_id', allBatchIds)
      const existingBrewsMap = new Map((existingBrewsArr || []).map(b => [b.batch_id, b]))

      // Collect all visibility changes to batch at the end
      const toShow: string[] = []
      const toHide: string[] = []
      const toInsert: { batch_id: string; display_order: number; is_visible: boolean }[] = []

      // Get max display order once
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

      // Execute all visibility changes in parallel (max 3 queries instead of N)
      const visibilityOps: Promise<any>[] = []
      if (toShow.length > 0) visibilityOps.push(supabase.from('selected_brews').update({ is_visible: true }).in('batch_id', toShow))
      if (toHide.length > 0) visibilityOps.push(supabase.from('selected_brews').update({ is_visible: false }).in('batch_id', toHide))
      if (toInsert.length > 0) visibilityOps.push(supabase.from('selected_brews').insert(toInsert))
      if (visibilityOps.length > 0) await Promise.all(visibilityOps)
    }

    // Get visible brews for full detail sync
    const { data: selectedBrews } = await supabase
      .from('selected_brews').select('*').eq('is_visible', true).order('display_order')

    let brewUpdatesCount = 0

    if (brewfatherEnabled && selectedBrews && selectedBrews.length > 0) {
      const brewfatherBatchIds = selectedBrews.map(b => b.batch_id).filter(id => !id.startsWith('custom_'))

      if (brewfatherBatchIds.length > 0) {
        const { data: fullBatchesData } = await supabase.functions.invoke(
          'brewfather-batches', { body: { batchIds: brewfatherBatchIds } }
        )
        const batchesToSync = fullBatchesData || []

        // Fetch readings in parallel
        const readingsResults = await Promise.all(
          batchesToSync.map((batch: any) =>
            supabase.functions.invoke('brewfather-readings', { body: { batchId: batch._id } })
              .then(r => ({ batch, readings: r.data || [], error: r.error }))
          )
        )

        const brewUpdates = readingsResults.map(result => {
          if (result.error) return null
          const batch = result.batch
          const readings = result.readings

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
          // Batch-fetch existing brew_readings for id + linked_controller_id (used for snapshots)
          const updateBatchIds = brewUpdates.map((u: any) => u.batch_id)
          const [{ error: upsertError }, { data: brewRecords }] = await Promise.all([
            supabase.from('brew_readings').upsert(brewUpdates, { onConflict: 'batch_id' }),
            supabase.from('brew_readings').select('id, batch_id, linked_controller_id').in('batch_id', updateBatchIds),
          ])
          if (upsertError) throw upsertError
          brewUpdatesCount = brewUpdates.length

          // Create snapshots for fermenting brews (parallel, using pre-fetched ids)
          const brewRecordsMap = new Map((brewRecords || []).map((r: any) => [r.batch_id, r]))
          const snapshotTasks = brewUpdates
            .filter((u: any) => (u.status === 'Jäsning' || u.status === 'Fermenting') && u.sg_data?.length > 0)
            .map(async (u: any) => {
              const record = brewRecordsMap.get(u.batch_id)
              if (record) {
                await createBrewSnapshots(supabase, record.id, record.linked_controller_id, u.sg_data)
              }
            })
          if (snapshotTasks.length > 0) await Promise.allSettled(snapshotTasks)
        }
      }
    }

    // ──────────────────────────────────────────────────────
    // STEP 2: RAPT full sync (device discovery)
    // ──────────────────────────────────────────────────────

    console.log('Running RAPT full sync...')
    try {
      const raptResult = await supabase.functions.invoke('sync-rapt-data', { body: {} })
      if (raptResult.error) console.error('RAPT full sync error:', raptResult.error)
      else console.log('RAPT full sync completed')
    } catch (e) {
      console.error('RAPT full sync failed:', e)
    }

    // ──────────────────────────────────────────────────────
    // STEP 3: Quick sync (fresh readings + automation)
    //         Runs AFTER all data sources are updated
    // ──────────────────────────────────────────────────────

    console.log('Running quick sync pass (data + automation)...')
    try {
      await supabase.functions.invoke('sync-rapt-data-quick', { body: {} })
      console.log('Quick sync pass completed')
    } catch (e) {
      console.error('Quick sync pass failed:', e)
    }

    // ──────────────────────────────────────────────────────
    // STEP 4: AI audit (analyzes fresh state after automation)
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

    console.log(`FULL sync completed: ${brewUpdatesCount} brews, RAPT full + AI audit`)

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