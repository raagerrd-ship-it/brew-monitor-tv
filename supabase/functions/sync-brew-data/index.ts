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

    // Update last_sync_time to trigger UI notification
    const { data: settingsData } = await supabase
      .from('sync_settings')
      .select('id')
      .limit(1)
      .single()
    
    if (settingsData) {
      await supabase
        .from('sync_settings')
        .update({ last_sync_time: new Date().toISOString() })
        .eq('id', settingsData.id)
    }

    // Get currently visible brews for syncing data
    const { data: selectedBrews, error: selectedError } = await supabase
      .from('selected_brews')
      .select('batch_id')
      .eq('is_visible', true)

    if (selectedError) {
      console.error('Error fetching selected brews:', selectedError)
      throw selectedError
    }

    if (!selectedBrews || selectedBrews.length === 0) {
      console.log('No visible brews to sync')
      return new Response(
        JSON.stringify({ message: 'No visible brews' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Quick syncing ${selectedBrews.length} visible brews (readings only)`)

    // Fetch all readings in parallel for maximum speed
    const readingsPromises = selectedBrews.map(brew =>
      supabase.functions.invoke('brewfather-readings', { 
        body: { batchId: brew.batch_id } 
      }).then(result => ({
        batchId: brew.batch_id,
        data: result.data,
        error: result.error
      }))
    )

    const readingsResults = await Promise.all(readingsPromises)
    console.log(`Fetched readings for ${readingsResults.length} batches in parallel`)

    // Fetch existing brew data in parallel to preserve OG, FG, style, etc.
    const existingBrewsPromises = selectedBrews.map(brew =>
      supabase
        .from('brew_readings')
        .select('batch_id, original_gravity, final_gravity, style, name, status, batch_number, sg_data')
        .eq('batch_id', brew.batch_id)
        .maybeSingle()
        .then(result => ({
          batchId: brew.batch_id,
          data: result.data
        }))
    )

    const existingBrews = await Promise.all(existingBrewsPromises)
    const existingBrewsMap = new Map(existingBrews.map(b => [b.batchId, b.data]))

    // Process all readings and prepare updates
    const brewUpdates = readingsResults.map(result => {
      if (result.error) {
        console.error(`Error fetching readings for ${result.batchId}:`, result.error)
        return null
      }

      const readings = result.data || []
      const existingBrew = existingBrewsMap.get(result.batchId)

      // Transform data
      const sgData = readings
        .filter((r: any) => r.sg && r.temp)
        .map((r: any) => ({
          date: new Date(r.time).toISOString(),
          value: r.sg,
          temp: r.temp,
        }))

      // Get the latest reading
      const readingsWithSG = readings.filter((r: any) => r.sg)
      const latestReading = readingsWithSG.length > 0 ? readingsWithSG[readingsWithSG.length - 1] : null
      const currentSG = latestReading?.sg || existingBrew?.original_gravity || 1.050
      const currentTemp = latestReading?.temp || 20
      const battery = latestReading?.battery ? Math.round(latestReading.battery) : null

      const og = existingBrew?.original_gravity || 1.050
      const fg = existingBrew?.final_gravity || 1.010
      
      const attenuation = ((og - currentSG) / (og - 1.000)) * 100
      const abv = ((og - currentSG) * 131.25) || 0

      return {
        batch_id: result.batchId,
        current_sg: currentSG,
        current_temp: currentTemp,
        attenuation: Math.round(attenuation),
        abv: parseFloat(abv.toFixed(1)),
        last_update: latestReading ? new Date(latestReading.time).toISOString() : null,
        battery: battery,
        sg_data: sgData.length > 0 ? sgData : existingBrew?.sg_data || [],
        // Preserve existing fields
        ...(existingBrew && {
          name: existingBrew.name,
          style: existingBrew.style,
          status: existingBrew.status,
          batch_number: existingBrew.batch_number,
          original_gravity: existingBrew.original_gravity,
          final_gravity: existingBrew.final_gravity
        })
      }
    }).filter(Boolean)

    // Batch upsert all updates at once
    if (brewUpdates.length > 0) {
      const { error: upsertError } = await supabase
        .from('brew_readings')
        .upsert(brewUpdates, { onConflict: 'batch_id' })

      if (upsertError) {
        console.error('Error batch upserting brews:', upsertError)
        throw upsertError
      }

      console.log(`Successfully quick synced ${brewUpdates.length} brews in parallel`)
    }

    return new Response(
      JSON.stringify({ message: 'Sync completed', count: brewUpdates.length }),
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
