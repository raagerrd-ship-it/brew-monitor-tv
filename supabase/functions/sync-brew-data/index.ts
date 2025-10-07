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

    // Get selected brews
    const { data: selectedBrews, error: selectedError } = await supabase
      .from('selected_brews')
      .select('*')
      .eq('is_visible', true)
      .order('display_order')
      .limit(3)

    if (selectedError) {
      console.error('Error fetching selected brews:', selectedError)
      throw selectedError
    }

    if (!selectedBrews || selectedBrews.length === 0) {
      console.log('No selected brews found')
      return new Response(
        JSON.stringify({ message: 'No selected brews' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Found ${selectedBrews.length} selected brews`)

    // Fetch batch data from Brewfather
    const batchIds = selectedBrews.map(brew => brew.batch_id)
    const authHeader = 'Basic ' + btoa(`${brewfatherUserId}:${brewfatherApiKey}`)

    const batchesResponse = await fetch(
      `https://api.brewfather.app/v2/batches?include=recipe`,
      {
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!batchesResponse.ok) {
      throw new Error(`Brewfather API error: ${batchesResponse.status}`)
    }

    const allBatches = await batchesResponse.json()
    const batchesData = allBatches.filter((b: any) => batchIds.includes(b._id))

    console.log(`Fetched ${batchesData.length} batches from Brewfather`)

    // Process each batch
    for (const batch of batchesData) {
      try {
        console.log(`Processing batch ${batch._id}...`)

        // Fetch readings for this batch
        const readingsResponse = await fetch(
          `https://api.brewfather.app/v2/batches/${batch._id}/readings`,
          {
            headers: {
              'Authorization': authHeader,
              'Content-Type': 'application/json',
            },
          }
        )

        let readings = []
        if (readingsResponse.ok) {
          readings = await readingsResponse.json()
          console.log(`Fetched ${readings.length} readings for batch ${batch._id}`)
        }

        // Transform data
        const sgData = readings
          .filter((r: any) => r.sg && r.temp)
          .map((r: any) => ({
            date: new Date(r.time).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' }),
            value: r.sg,
            temp: r.temp,
          }))

        const latestReading = readings.length > 0 ? readings[readings.length - 1] : null
        const currentSG = latestReading?.sg || batch.measuredOg || batch.estimatedOg || 1.050
        const currentTemp = latestReading?.temp || 20

        const og = batch.measuredOg || batch.estimatedOg || 1.050
        const fg = batch.measuredFg || batch.estimatedFg || 1.010
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
          console.log(`Successfully synced batch ${batch._id}`)
        }
      } catch (error) {
        console.error(`Error processing batch ${batch._id}:`, error)
      }
    }

    console.log('Brew data sync completed')

    return new Response(
      JSON.stringify({ message: 'Sync completed', count: batchesData.length }),
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
