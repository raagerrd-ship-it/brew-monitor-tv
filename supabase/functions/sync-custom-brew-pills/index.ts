import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { createBrewSnapshots } from '../_shared/brew-snapshots.ts';

// ── Inlined RAPT pill telemetry fetch (saves 1 HTTP hop per brew) ──
async function fetchPillTelemetry(
  accessToken: string, pillId: string, startDate: string, endDate: string
): Promise<any[]> {
  const apiBaseUrl = Deno.env.get('RAPT_API_BASE_URL') || 'https://api.rapt.io';
  const params = new URLSearchParams({ hydrometerId: pillId, startDate, endDate });
  const res = await fetch(`${apiBaseUrl}/api/Hydrometers/GetTelemetry?${params}`, {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`RAPT telemetry API error: ${res.status} ${errText}`);
  }
  return res.json();
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface TelemetryRecord {
  createdOn: string;
  gravity: number;
  temperature: number;
  battery: number;
}

import type { SgDataPoint } from '../_shared/types.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Starting custom brew pill sync...');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get custom brews that are actively fermenting
    const { data: customBrews, error: brewsError } = await supabase
      .from('brew_readings')
      .select('*')
      .like('batch_id', 'custom\\_%')
      .in('status', ['Jäsning', 'Fermenting']);

    if (brewsError) {
      throw new Error(`Failed to fetch custom brews: ${brewsError.message}`);
    }

    if (!customBrews || customBrews.length === 0) {
      console.log('No custom brews in fermentation found');
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No custom brews in fermentation',
          brewsUpdated: 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${customBrews.length} custom brews in fermentation`);

    // Get auth token + pill/controller data — prefer passed-in from sync-rapt-data-quick
    let access_token: string = '';
    let allPills: any[] | null = null;
    let allControllers: any[] | null = null;
    try {
      const body = await req.json().catch(() => ({}));
      access_token = body?.access_token || '';
      // Use passed-in pill/controller data if available (saves 2 DB queries)
      if (body?.pills && Array.isArray(body.pills)) allPills = body.pills;
      if (body?.controllers && Array.isArray(body.controllers)) allControllers = body.controllers;
    } catch {
      // no body
    }

    // Fallback: query DB only if data wasn't passed in
    if (!allPills || !allControllers) {
      const [{ data: dbPills }, { data: dbControllers }] = await Promise.all([
        allPills ? Promise.resolve({ data: allPills }) : supabase.from('rapt_pills').select('pill_id, name, paired_device_id'),
        allControllers ? Promise.resolve({ data: allControllers }) : supabase.from('rapt_temp_controllers').select('controller_id, linked_pill_id, pill_temp'),
      ]);
      if (!allPills) allPills = dbPills;
      if (!allControllers) allControllers = dbControllers;
    }
    
    if (!access_token) {
      console.log('No token passed, getting own RAPT auth token...');
      // Inlined auth — no HTTP hop to rapt-auth
      const RAPT_USERNAME = Deno.env.get('RAPT_USERNAME');
      const RAPT_API_SECRET = Deno.env.get('RAPT_API_SECRET');
      if (!RAPT_USERNAME || !RAPT_API_SECRET) throw new Error('RAPT credentials not configured');
      const formData = new URLSearchParams();
      formData.append('client_id', 'rapt-user');
      formData.append('grant_type', 'password');
      formData.append('username', RAPT_USERNAME);
      formData.append('password', RAPT_API_SECRET);
      const authBaseUrl = Deno.env.get('RAPT_AUTH_BASE_URL') || 'https://id.rapt.io';
      const authRes = await fetch(`${authBaseUrl}/connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
        signal: AbortSignal.timeout(15000),
      });
      if (!authRes.ok) throw new Error(`RAPT auth error: ${authRes.status}`);
      const authData = await authRes.json();
      access_token = authData.access_token;
    } else {
      console.log('Using passed-in RAPT auth token');
    }
    let brewsUpdated = 0;

    for (const brew of customBrews) {
      try {
        // Auto-resolve pill_id via paired_device_id matching
        // Priority: 1) linked_pill_id on brew (legacy), 2) linked_controller_id → controller's linked_pill_id, 3) paired_device_id temp matching
        let pillId = brew.linked_pill_id;
        
        if (!pillId && brew.linked_controller_id) {
          const controller = allControllers?.find(c => c.controller_id === brew.linked_controller_id);
          if (controller?.linked_pill_id) {
            pillId = controller.linked_pill_id;
          }
        }

        if (!pillId) {
          // Try paired_device_id: find a pill paired to a controller whose pill_temp matches brew temp
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

        console.log(`Processing brew: ${brew.name} (pill: ${pillId})`);

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

        // Fetch telemetry data (inlined — no HTTP hop)
        let telemetryData: any[];
        try {
          telemetryData = await fetchPillTelemetry(
            access_token, pillId, startDate.toISOString(), endDate.toISOString()
          );
        } catch (telemetryError) {
          console.error(`Failed to fetch telemetry for brew ${brew.name}:`, telemetryError);
          continue;
        }

        if (!telemetryData || !Array.isArray(telemetryData) || telemetryData.length === 0) {
          console.log(`No new telemetry data for brew ${brew.name}, checking controller fallback...`);
          
          // Fallback: use pre-fetched controller data (Problem 5: no DB query needed)
          if (brew.linked_controller_id) {
            // Look up from allControllers array first
            const ctrlFromMemory = allControllers?.find(c => c.controller_id === brew.linked_controller_id);
            
            // If passed-in data has pill_temp but not full controller data, query DB
            let ctrlFull: any = null;
            if (ctrlFromMemory) {
              // We have basic data from memory, but need full data for snapshots
              // Query DB only once for the fields we need
              const { data } = await supabase
                .from('rapt_temp_controllers')
                .select('current_temp, pill_temp, target_temp, profile_target_temp')
                .eq('controller_id', brew.linked_controller_id)
                .maybeSingle();
              ctrlFull = data;
            } else {
              const { data } = await supabase
                .from('rapt_temp_controllers')
                .select('current_temp, pill_temp, target_temp, profile_target_temp')
                .eq('controller_id', brew.linked_controller_id)
                .maybeSingle();
              ctrlFull = data;
            }
            
            if (ctrlFull) {
              const fallbackTemp = ctrlFull.current_temp;
              const brewUpdate = fallbackTemp != null ? supabase
                .from('brew_readings')
                .update({ current_temp: fallbackTemp, updated_at: new Date().toISOString() })
                .eq('id', brew.id) : Promise.resolve({ error: null });

              const now = new Date().toISOString();
              const snapshot = {
                brew_id: brew.id,
                recorded_at: now,
                sg: brew.current_sg ?? null,
                pill_temp: null as number | null,
                controller_temp: ctrlFull.current_temp ?? null,
                profile_target_temp: ctrlFull.profile_target_temp ?? null,
                auto_target_temp: ctrlFull.target_temp ?? null,
              };
              const snapshotInsert = supabase.from('brew_data_snapshots').insert(snapshot);

              // Execute both in parallel
              const [brewRes, snapRes] = await Promise.all([brewUpdate, snapshotInsert]);
              if (brewRes.error) console.error(`Failed to update brew ${brew.name}:`, brewRes.error);
              else if (fallbackTemp != null) { console.log(`Updated ${brew.name} with controller probe temp: ${fallbackTemp}°C`); brewsUpdated++; }
              if (snapRes.error) console.error(`Failed to insert snapshot for ${brew.name}:`, snapRes.error);
              else console.log(`Created controller-only snapshot for ${brew.name}`);
            }
          }
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

        // Even if no new data points, we should still update current values
        // Only skip if mergedSgData is empty (nothing to update from)
        if (mergedSgData.length === 0) {
          console.log(`No data for brew ${brew.name}`);
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

        // Log values being updated
        console.log(`Updating ${brew.name} with values:`, {
          current_sg: currentSg,
          current_temp: latestData.temp,
          battery: latestTelemetry.battery,
          last_update: latestData.date,
          og,
          attenuation,
          abv,
          sg_data_length: mergedSgData.length
        });

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

        // Create data snapshots for all sg_data points (locks Datum, SG, Pill, Ctrl, Mål, Auto)
        if (uniqueNewData.length > 0) {
          await createBrewSnapshots(supabase, brew.id, brew.linked_controller_id, mergedSgData);
        }

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
