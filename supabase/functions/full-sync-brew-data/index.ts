import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    console.log('Starting FULL brew data sync...')

    // Get sync settings to determine auto-management behavior
    const { data: syncSettings } = await supabase
      .from('sync_settings')
      .select('auto_hide_completed, auto_hide_conditioning, auto_activate_fermenting')
      .limit(1)
      .maybeSingle()

    const autoHideCompleted = syncSettings?.auto_hide_completed ?? true
    const autoHideConditioning = syncSettings?.auto_hide_conditioning ?? true
    const autoActivateFermenting = syncSettings?.auto_activate_fermenting ?? true

    console.log('Auto-management settings:', { autoHideCompleted, autoHideConditioning, autoActivateFermenting })

    // Fetch ALL batches from Brewfather
    const { data: batchesData, error: batchesError } = await supabase.functions.invoke(
      'brewfather-batches',
      { body: {} }
    )

    if (batchesError) {
      console.error('Error fetching batches:', batchesError)
      throw batchesError
    }

    if (!batchesData || batchesData.length === 0) {
      console.log('No batches found from Brewfather')
      return new Response(
        JSON.stringify({ message: 'No batches found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Fetched ${batchesData.length} batches from Brewfather`)

    // Auto-manage selected_brews based on fermentation status
    console.log('Managing selected_brews based on fermentation status...')
    
    const fermentingBatches = batchesData
      .filter((batch: any) => batch.status === 'Fermenting')
      .sort((a: any, b: any) => {
        const dateA = new Date(a.brewDate || 0).getTime()
        const dateB = new Date(b.brewDate || 0).getTime()
        return dateB - dateA
      })

    console.log(`Found ${fermentingBatches.length} fermenting batches`)

    const top3Fermenting = fermentingBatches.slice(0, 3)
    const top3FermentingIds = top3Fermenting.map((b: any) => b._id)

    for (const batch of batchesData) {
      const isFermenting = batch.status === 'Fermenting'
      const isCompleted = batch.status === 'Completed'
      const isConditioning = batch.status === 'Conditioning'
      const isInTop3 = top3FermentingIds.includes(batch._id)
      
      const { data: existingBrew } = await supabase
        .from('selected_brews')
        .select('*')
        .eq('batch_id', batch._id)
        .maybeSingle()

      // Determine if this brew should be visible based on settings
      let shouldBeVisible = false
      
      if (isFermenting && isInTop3 && autoActivateFermenting) {
        shouldBeVisible = true
      } else if (existingBrew) {
        // Keep manually selected brews visible unless they match auto-hide criteria
        shouldBeVisible = existingBrew.is_visible
        
        if (isCompleted && autoHideCompleted) {
          shouldBeVisible = false
        }
        if (isConditioning && autoHideConditioning) {
          shouldBeVisible = false
        }
      }

      if (shouldBeVisible) {
        if (existingBrew) {
          if (!existingBrew.is_visible) {
            await supabase
              .from('selected_brews')
              .update({ is_visible: true })
              .eq('batch_id', batch._id)
            console.log(`Auto-activated brew: ${batch._id} (status: ${batch.status})`)
          }
        } else if (autoActivateFermenting && isFermenting && isInTop3) {
          const { data: maxOrder } = await supabase
            .from('selected_brews')
            .select('display_order')
            .order('display_order', { ascending: false })
            .limit(1)
            .maybeSingle()
          
          const nextOrder = (maxOrder?.display_order || 0) + 1
          
          await supabase
            .from('selected_brews')
            .insert({
              batch_id: batch._id,
              display_order: nextOrder,
              is_visible: true
            })
          console.log(`Auto-added fermenting brew: ${batch._id}`)
        }
      } else {
        if (existingBrew && existingBrew.is_visible) {
          await supabase
            .from('selected_brews')
            .update({ is_visible: false })
            .eq('batch_id', batch._id)
          
          console.log(`Auto-deactivated brew: ${batch._id} (status: ${batch.status})`)
        }
      }
    }

    // Get currently visible brews for full syncing
    const { data: selectedBrews, error: selectedError } = await supabase
      .from('selected_brews')
      .select('*')
      .eq('is_visible', true)
      .order('display_order')

    if (selectedError) {
      console.error('Error fetching selected brews:', selectedError)
      throw selectedError
    }

    if (!selectedBrews || selectedBrews.length === 0) {
      console.log('No visible brews after auto-management')
      return new Response(
        JSON.stringify({ message: 'No visible brews' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Found ${selectedBrews.length} visible brews to sync`)

    // Fetch full batch details for selected batches
    const selectedBatchIds = selectedBrews.map(b => b.batch_id)
    console.log(`Fetching FULL batch details for ${selectedBatchIds.length} batches...`)
    
    const { data: fullBatchesData, error: fullBatchesError } = await supabase.functions.invoke(
      'brewfather-batches',
      { body: { batchIds: selectedBatchIds } }
    )

    if (fullBatchesError) {
      console.error('Error fetching full batch details:', fullBatchesError)
      throw fullBatchesError
    }

    const batchesToSync = fullBatchesData || []
    console.log(`Got ${batchesToSync.length} full batch details`)

    // Process each batch with FULL data including OG
    for (const batch of batchesToSync) {
      try {
        console.log(`Processing batch ${batch._id} with FULL details...`)

        const { data: readingsData, error: readingsError } = await supabase.functions.invoke(
          'brewfather-readings',
          { body: { batchId: batch._id } }
        )

        if (readingsError) {
          console.error('Error fetching readings for batch:', batch._id, readingsError)
        }

        const readings = readingsData || []
        console.log(`Fetched ${readings.length} readings for batch ${batch._id}`)

        const sgData = readings
          .filter((r: any) => r.sg && r.temp)
          .map((r: any) => ({
            date: new Date(r.time).toISOString(),
            value: r.sg,
            temp: r.temp,
          }))

        const latestReading = readings.length > 0 ? readings[readings.length - 1] : null
        const currentSG = latestReading?.sg || batch.measuredOg || batch.estimatedOg || 1.050
        const currentTemp = latestReading?.temp || 20
        const battery = latestReading?.battery ? Math.round(latestReading.battery) : null

        // Use batch measuredOg first (this is what user fills in manually in Brewfather)
        const firstReading = readings.length > 0 ? readings[0] : null
        const og = batch.measuredOg || batch.estimatedOg || firstReading?.sg || 1.050
        const fg = batch.measuredFg || batch.estimatedFg || 1.010
        
        console.log(`Batch ${batch.name || batch.recipe?.name}: measuredOg=${batch.measuredOg}, estimatedOg=${batch.estimatedOg}, using og=${og}`)
        
        const attenuation = ((og - currentSG) / (og - fg)) * 100
        const abv = ((og - currentSG) * 131.25) || batch.estimatedAbv || 0

        const brewData = {
          batch_id: batch._id,
          name: batch.recipe?.name || batch.name,
          style: batch.recipe?.style?.name || 'Okänd stil',
          batch_number: `#${batch.batchNo}`,
          status: batch.status === 'Conditioning' ? 'Konditionering' : 
                  batch.status === 'Completed' ? 'Klar' : 
                  batch.status === 'Fermenting' ? 'Jäsning' : batch.status,
          current_sg: currentSG,
          current_temp: currentTemp,
          attenuation: Math.round(attenuation),
          abv: parseFloat(abv.toFixed(1)),
          original_gravity: og,
          final_gravity: fg,
          last_update: latestReading ? new Date(latestReading.time).toISOString() : null,
          battery: battery,
          sg_data: sgData.length > 0 ? sgData : [
            { date: 'Start', value: og, temp: 20 },
            { date: 'Nu', value: currentSG, temp: currentTemp },
          ],
        }

        const { error: upsertError } = await supabase
          .from('brew_readings')
          .upsert(brewData, { onConflict: 'batch_id' })

        if (upsertError) {
          console.error(`Error upserting batch ${batch._id}:`, upsertError)
        } else {
          console.log(`Successfully synced batch ${batch._id} with FULL data`)
        }
      } catch (error) {
        console.error(`Error processing batch ${batch._id}:`, error)
      }
    }

    console.log('FULL brew data sync completed')

    return new Response(
      JSON.stringify({ message: 'Full sync completed', count: batchesToSync.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error in full-sync-brew-data:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})