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
    const brewfatherUserId = Deno.env.get('BREWFATHER_USER_ID')!
    const brewfatherApiKey = Deno.env.get('BREWFATHER_API_KEY')!

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    console.log('Starting brew data sync...')

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

    // Fetch ALL batches from Brewfather to check status
    console.log('Fetching all batches from Brewfather...')
    
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

    // Auto-manage selected_brews based on fermentation status and settings
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

    // Get currently visible brews for syncing data
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

    // Filter batches to only those that are selected and visible
    const selectedBatchIds = selectedBrews.map(b => b.batch_id)
    const batchesToSync = batchesData.filter((b: any) => selectedBatchIds.includes(b._id))
    
    console.log(`Syncing ${batchesToSync.length} batches (quick sync - readings only)`)

    // Process each batch
    for (const batch of batchesToSync) {
      try {
        console.log(`Quick sync for batch ${batch._id}...`)

        // Fetch readings for this batch
        const { data: readingsData, error: readingsError } = await supabase.functions.invoke(
          'brewfather-readings',
          { body: { batchId: batch._id } }
        )

        if (readingsError) {
          console.error('Error fetching readings for batch:', batch._id, readingsError)
        }

        const readings = readingsData || []
        console.log(`Fetched ${readings.length} readings for batch ${batch._id}`)

        // Get existing brew data to preserve OG, style and other batch details
        const { data: existingBrew } = await supabase
          .from('brew_readings')
          .select('original_gravity, final_gravity, style, name, last_update')
          .eq('batch_id', batch._id)
          .maybeSingle()

        // Transform data
        const sgData = readings
          .filter((r: any) => r.sg && r.temp)
          .map((r: any) => ({
            date: new Date(r.time).toISOString(),
            value: r.sg,
            temp: r.temp,
          }))

        const latestReading = readings.length > 0 ? readings[readings.length - 1] : null
        const currentSG = latestReading?.sg || 1.050
        const currentTemp = latestReading?.temp || 20
        const battery = latestReading?.battery ? Math.round(latestReading.battery) : null

        // Use existing OG/FG if available, otherwise fallback
        const og = existingBrew?.original_gravity || 1.050
        const fg = existingBrew?.final_gravity || 1.010
        
        // Calculate apparent attenuation: (OG - Current SG) / (OG - 1.000) * 100
        const attenuation = ((og - currentSG) / (og - 1.000)) * 100
        const abv = ((og - currentSG) * 131.25) || 0

        const brewData = {
          batch_id: batch._id,
          name: existingBrew?.name || batch.recipe?.name || batch.name,
          style: existingBrew?.style || batch.recipe?.style?.name || 'Okänd stil',
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
          last_update: latestReading ? new Date(latestReading.time).toISOString() : existingBrew?.last_update || null,
          battery: battery,
          sg_data: sgData.length > 0 ? sgData : [
            { date: 'Start', value: og, temp: 20 },
            { date: 'Nu', value: currentSG, temp: currentTemp },
          ],
        }

        // Upsert to database
        const { error: upsertError } = await supabase
          .from('brew_readings')
          .upsert(brewData, { onConflict: 'batch_id' })

        if (upsertError) {
          console.error(`Error upserting batch ${batch._id}:`, upsertError)
        } else {
          console.log(`Successfully quick synced batch ${batch._id}`)
        }
      } catch (error) {
        console.error(`Error processing batch ${batch._id}:`, error)
      }
    }

    console.log('Brew data sync completed')

    return new Response(
      JSON.stringify({ message: 'Sync completed', count: batchesToSync.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error in sync-brew-data:', error)
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
