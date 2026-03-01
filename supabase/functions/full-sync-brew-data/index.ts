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

    // Update timestamps
    const { data: settingsData } = await supabase
      .from('sync_settings').select('id').limit(1).single()
    
    if (settingsData) {
      await supabase.from('sync_settings').update({ 
        last_sync_time: new Date().toISOString(),
        last_full_sync_at: new Date().toISOString()
      }).eq('id', settingsData.id)
    }

    // Get sync settings for auto-management
    const { data: syncSettings } = await supabase
      .from('sync_settings')
      .select('auto_hide_completed, auto_hide_conditioning, auto_activate_fermenting, auto_hide_archived')
      .limit(1).maybeSingle()

    const autoHideCompleted = syncSettings?.auto_hide_completed ?? true
    const autoHideConditioning = syncSettings?.auto_hide_conditioning ?? true
    const autoActivateFermenting = syncSettings?.auto_activate_fermenting ?? true
    const autoHideArchived = syncSettings?.auto_hide_archived ?? true

    // ──────────────────────────────────────────────────────
    // STEP 1: Brewfather full batch sync + auto-manage
    // ──────────────────────────────────────────────────────

    let batchesData: any[] = []
    try {
      const { data, error: batchesError } = await supabase.functions.invoke('brewfather-batches', { body: {} })
      if (batchesError) console.error('Error fetching batches:', batchesError)
      else batchesData = data || []
    } catch (e) {
      console.error('Failed to fetch Brewfather batches:', e)
    }

    console.log(`Fetched ${batchesData.length} batches from Brewfather`)

    // Auto-manage selected_brews
    if (batchesData.length > 0) {
      const fermentingBatches = batchesData
        .filter((b: any) => b.status === 'Fermenting')
        .sort((a: any, b: any) => new Date(b.brewDate || 0).getTime() - new Date(a.brewDate || 0).getTime())
      const top3FermentingIds = fermentingBatches.slice(0, 3).map((b: any) => b._id)

      for (const batch of batchesData) {
        const isFermenting = batch.status === 'Fermenting'
        const isCompleted = batch.status === 'Completed'
        const isConditioning = batch.status === 'Conditioning'
        const isArchived = batch.status === 'Archived'
        const isInTop3 = top3FermentingIds.includes(batch._id)

        const { data: existingBrew } = await supabase
          .from('selected_brews').select('*').eq('batch_id', batch._id).maybeSingle()

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
            if (!existingBrew.is_visible) {
              await supabase.from('selected_brews').update({ is_visible: true }).eq('batch_id', batch._id)
            }
          } else if (autoActivateFermenting && isFermenting && isInTop3) {
            const { data: maxOrder } = await supabase.from('selected_brews')
              .select('display_order').order('display_order', { ascending: false }).limit(1).maybeSingle()
            await supabase.from('selected_brews').insert({
              batch_id: batch._id, display_order: (maxOrder?.display_order || 0) + 1, is_visible: true
            })
          }
        } else if (existingBrew?.is_visible) {
          await supabase.from('selected_brews').update({ is_visible: false }).eq('batch_id', batch._id)
        }
      }
    }

    // Get visible brews for full detail sync
    const { data: selectedBrews } = await supabase
      .from('selected_brews').select('*').eq('is_visible', true).order('display_order')

    let brewUpdatesCount = 0

    if (selectedBrews && selectedBrews.length > 0) {
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
          const { error: upsertError } = await supabase.from('brew_readings')
            .upsert(brewUpdates, { onConflict: 'batch_id' })
          if (upsertError) throw upsertError
          brewUpdatesCount = brewUpdates.length

          // Create snapshots for fermenting brews
          for (const update of brewUpdates) {
            const u = update as any
            const isFermenting = u.status === 'Jäsning' || u.status === 'Fermenting'
            if (isFermenting && u.sg_data?.length > 0) {
              const { data: brewRecord } = await supabase.from('brew_readings')
                .select('id, linked_controller_id').eq('batch_id', u.batch_id).single()
              if (brewRecord) {
                await createBrewSnapshots(supabase, brewRecord.id, brewRecord.linked_controller_id, u.sg_data)
              }
            }
          }
        }
      }
    }

    // ──────────────────────────────────────────────────────
    // STEP 2: RAPT full sync + AI audit (parallel)
    // ──────────────────────────────────────────────────────

    // Get AI audit setting
    const { data: autoCoolingSettings } = await supabase
      .from('auto_cooling_settings').select('ai_audit_enabled').limit(1).maybeSingle()
    const aiAuditEnabled = autoCoolingSettings?.ai_audit_enabled ?? true

    console.log('Triggering RAPT full sync + AI audit in parallel...')

    const [raptResult, aiResult] = await Promise.allSettled([
      supabase.functions.invoke('sync-rapt-data', { body: {} }),
      aiAuditEnabled
        ? supabase.functions.invoke('ai-automation-audit', { body: {} })
        : Promise.resolve({ data: { skipped: true }, error: null }),
    ])

    if (raptResult.status === 'rejected') console.error('RAPT full sync failed:', raptResult.reason)
    else if (raptResult.status === 'fulfilled' && raptResult.value.error) console.error('RAPT full sync error:', raptResult.value.error)
    else console.log('RAPT full sync completed')

    if (aiResult.status === 'rejected') console.error('AI audit failed:', aiResult.reason)
    else if (aiResult.status === 'fulfilled' && aiResult.value.error) console.error('AI audit error:', aiResult.value.error)
    else console.log('AI audit completed')

    // ──────────────────────────────────────────────────────
    // STEP 3: Quick sync (to get fresh data after full)
    // ──────────────────────────────────────────────────────

    console.log('Running quick sync pass...')
    try {
      await supabase.functions.invoke('sync-rapt-data-quick', { body: {} })
      console.log('Quick sync pass completed')
    } catch (e) {
      console.error('Quick sync pass failed:', e)
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
