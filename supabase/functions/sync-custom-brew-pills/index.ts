import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TelemetryRecord {
  createdOn: string;
  gravity: number;
  temperature: number;
  battery: number;
}

interface SgDataPoint {
  date: string;
  value: number;
  temp: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Starting custom brew pill sync...');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get custom brews with linked pills (custom brews have batch_id starting with 'custom_')
    const { data: customBrews, error: brewsError } = await supabase
      .from('brew_readings')
      .select('*')
      .not('linked_pill_id', 'is', null)
      .like('batch_id', 'custom\\_%')
      .in('status', ['Fermenting', 'Conditioning', 'Brewing']);

    if (brewsError) {
      throw new Error(`Failed to fetch custom brews: ${brewsError.message}`);
    }

    if (!customBrews || customBrews.length === 0) {
      console.log('No custom brews with linked pills found');
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No custom brews with linked pills',
          brewsUpdated: 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${customBrews.length} custom brews with linked pills`);

    // Get auth token
    console.log('Getting RAPT auth token...');
    const { data: authData, error: authError } = await supabase.functions.invoke('rapt-auth');
    
    if (authError) {
      throw new Error(`Failed to get auth token: ${authError.message}`);
    }
    
    const { access_token } = authData;
    let brewsUpdated = 0;

    for (const brew of customBrews) {
      try {
        console.log(`Processing brew: ${brew.name} (pill: ${brew.linked_pill_id})`);

        // Calculate date range - from last update or 7 days ago
        const endDate = new Date();
        let startDate: Date;
        
        if (brew.last_update) {
          // Start from last update, minus a small buffer to ensure overlap
          startDate = new Date(brew.last_update);
          startDate.setMinutes(startDate.getMinutes() - 5);
        } else {
          // No previous data, fetch last 7 days
          startDate = new Date();
          startDate.setDate(startDate.getDate() - 7);
        }

        console.log(`Fetching telemetry from ${startDate.toISOString()} to ${endDate.toISOString()}`);

        // Fetch telemetry data
        const { data: telemetryData, error: telemetryError } = await supabase.functions.invoke('rapt-pill-telemetry', {
          body: {
            access_token,
            pill_id: brew.linked_pill_id,
            start_date: startDate.toISOString(),
            end_date: endDate.toISOString()
          }
        });

        if (telemetryError) {
          console.error(`Failed to fetch telemetry for brew ${brew.name}:`, telemetryError);
          continue;
        }

        if (!telemetryData || !Array.isArray(telemetryData) || telemetryData.length === 0) {
          console.log(`No new telemetry data for brew ${brew.name}`);
          continue;
        }

        console.log(`Received ${telemetryData.length} telemetry records`);

        // Convert telemetry to sg_data format
        const newSgData: SgDataPoint[] = telemetryData.map((t: TelemetryRecord) => ({
          date: new Date(t.createdOn).toISOString(),
          value: t.gravity,
          temp: t.temperature
        }));

        // Get existing sg_data and merge
        const existingSgData: SgDataPoint[] = Array.isArray(brew.sg_data) ? brew.sg_data : [];
        
        // Create a Set of existing dates for deduplication
        const existingDates = new Set(existingSgData.map(d => d.date));
        
        // Add only new data points
        const uniqueNewData = newSgData.filter(d => !existingDates.has(d.date));
        
        // Merge and sort by date
        const mergedSgData = [...existingSgData, ...uniqueNewData]
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        console.log(`Merged sg_data: ${existingSgData.length} existing + ${uniqueNewData.length} new = ${mergedSgData.length} total`);

        if (uniqueNewData.length === 0) {
          console.log(`No new data points for brew ${brew.name}`);
          continue;
        }

        // Get the latest data point
        const latestData = mergedSgData[mergedSgData.length - 1];
        const latestTelemetry = telemetryData[telemetryData.length - 1] as TelemetryRecord;
        
        // Calculate attenuation and ABV
        const og = brew.original_gravity;
        const currentSg = latestData.value;
        const attenuation = og > 1 ? Math.round(((og - currentSg) / (og - 1)) * 100) : 0;
        const abv = og > 1 ? Number(((og - currentSg) * 131.25).toFixed(1)) : 0;

        // Update brew_readings
        const { error: updateError } = await supabase
          .from('brew_readings')
          .update({
            sg_data: mergedSgData,
            current_sg: currentSg,
            current_temp: latestData.temp,
            attenuation: Math.max(0, Math.min(100, attenuation)),
            abv: Math.max(0, abv),
            battery: latestTelemetry.battery,
            last_update: latestData.date,
            updated_at: new Date().toISOString()
          })
          .eq('id', brew.id);

        if (updateError) {
          console.error(`Failed to update brew ${brew.name}:`, updateError);
          continue;
        }

        console.log(`Successfully updated brew ${brew.name} with ${uniqueNewData.length} new data points`);
        brewsUpdated++;

      } catch (brewError) {
        console.error(`Error processing brew ${brew.name}:`, brewError);
        continue;
      }
    }

    console.log(`Custom brew pill sync complete. Updated ${brewsUpdated}/${customBrews.length} brews`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        brewsUpdated,
        totalBrews: customBrews.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in sync-custom-brew-pills:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
