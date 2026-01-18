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
      .in('status', ['Jäsning', 'Konditionering', 'Bryggning', 'Fermenting', 'Conditioning', 'Brewing']);

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

        // Calculate date range
        const endDate = new Date();
        let startDate: Date;
        
        // Check if sg_data is empty (no previous sync has succeeded)
        const existingSgData: SgDataPoint[] = Array.isArray(brew.sg_data) ? brew.sg_data : [];
        const hasNoData = existingSgData.length === 0;
        
        if (hasNoData) {
          // No data yet - use fermentation_start if set, otherwise use created_at or 30 days ago
          if (brew.fermentation_start) {
            startDate = new Date(brew.fermentation_start);
            console.log(`No existing data for ${brew.name}, fetching from fermentation start: ${startDate.toISOString()}`);
          } else {
            const brewCreatedDate = new Date(brew.created_at);
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            startDate = brewCreatedDate < thirtyDaysAgo ? thirtyDaysAgo : brewCreatedDate;
            console.log(`No existing data for ${brew.name}, fetching from ${startDate.toISOString()}`);
          }
        } else if (brew.fermentation_start) {
          // Has data, filter by fermentation_start first, then fetch from last_update
          if (brew.last_update) {
            startDate = new Date(brew.last_update);
            startDate.setMinutes(startDate.getMinutes() - 5);
          } else {
            startDate = new Date(brew.fermentation_start);
          }
        } else if (brew.last_update) {
          // Has data and last_update - start from there with buffer
          startDate = new Date(brew.last_update);
          startDate.setMinutes(startDate.getMinutes() - 5);
        } else {
          // Has data but no last_update (shouldn't happen, but fallback)
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
        // RAPT API returns gravity as SG * 1000 (e.g., 1047.77 = SG 1.04777)
        // Filter out invalid readings (SG should be between 0.990 and 1.200 for beer)
        // Also filter out readings before fermentation_start if set
        const fermentationStartDate = brew.fermentation_start ? new Date(brew.fermentation_start) : null;
        
        const newSgData: SgDataPoint[] = telemetryData
          .map((t: TelemetryRecord) => ({
            date: new Date(t.createdOn).toISOString(),
            value: t.gravity / 1000, // Convert from RAPT format to standard SG
            temp: t.temperature
          }))
          .filter((d: SgDataPoint) => {
            // Filter by SG range
            if (d.value < 0.990 || d.value > 1.200) return false;
            // Filter by fermentation start date
            if (fermentationStartDate && new Date(d.date) < fermentationStartDate) return false;
            return true;
          });

        console.log(`Filtered to ${newSgData.length} valid SG readings (0.990-1.200 range)`);

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

        // Get the first and latest data points
        const firstData = mergedSgData[0];
        const latestData = mergedSgData[mergedSgData.length - 1];
        const latestTelemetry = telemetryData[telemetryData.length - 1] as TelemetryRecord;
        
        // Auto-update OG to first SG value ONLY on initial sync (when there was no data before)
        // This ensures manually set OG values are preserved
        // Only update if the first SG is reasonable (between 1.030 and 1.150)
        let og = brew.original_gravity;
        const firstSgIsReasonableOg = firstData.value >= 1.030 && firstData.value <= 1.150;
        
        if (hasNoData && firstSgIsReasonableOg) {
          og = firstData.value;
          console.log(`Auto-updating OG for ${brew.name} from ${brew.original_gravity} to ${og} (initial sync)`);
        }
        
        // Calculate attenuation and ABV using (potentially updated) OG
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
            original_gravity: og, // Update OG if changed
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
