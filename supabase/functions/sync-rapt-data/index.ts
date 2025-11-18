import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Starting RAPT Pills sync...');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Update last sync timestamp - get first settings row
    const { data: settings } = await supabase
      .from('sync_settings')
      .select('id')
      .limit(1)
      .single();
    
    if (settings) {
      await supabase
        .from('sync_settings')
        .update({ last_rapt_sync_at: new Date().toISOString() })
        .eq('id', settings.id);
      
      console.log('Updated last_rapt_sync_at timestamp');
    }

    // Get RAPT auth token
    console.log('Getting RAPT auth token...');
    const authResponse = await supabase.functions.invoke('rapt-auth');
    
    if (authResponse.error) {
      throw new Error(`Failed to get RAPT auth token: ${authResponse.error.message}`);
    }

    const { access_token } = authResponse.data;

    // Get Pills data
    console.log('Fetching Pills data...');
    const pillsResponse = await supabase.functions.invoke('rapt-pills', {
      body: { access_token }
    });

    if (pillsResponse.error) {
      throw new Error(`Failed to get Pills data: ${pillsResponse.error.message}`);
    }

    const pills = pillsResponse.data;
    console.log(`Received ${pills.length} Pills`, JSON.stringify(pills, null, 2));

    // Get Temperature Controllers data
    console.log('Fetching Temperature Controllers data...');
    const controllersResponse = await supabase.functions.invoke('rapt-temp-controllers', {
      body: { access_token }
    });

    if (controllersResponse.error) {
      console.error('Failed to get Temperature Controllers data:', controllersResponse.error.message);
      // Continue with pills sync even if controllers fail
    }

    const controllers = controllersResponse.data || [];
    console.log(`Received ${controllers.length} Temperature Controllers`);
    if (controllers.length > 0) {
      console.log('First controller full data:', JSON.stringify(controllers[0], null, 2));
    }

    // Map color names to hex colors (both English and Swedish)
    const colorMap: Record<string, string> = {
      'black': '#1f2937',
      'svart': '#1f2937',
      'blue': '#3b82f6',
      'blå': '#3b82f6',
      'green': '#22c55e',
      'grön': '#22c55e',
      'orange': '#f97316',
      'pink': '#ec4899',
      'rosa': '#ec4899',
      'purple': '#a855f7',
      'lila': '#a855f7',
      'red': '#ef4444',
      'röd': '#ef4444',
      'yellow': '#eab308',
      'gul': '#eab308',
      'white': '#f3f4f6',
      'vit': '#f3f4f6',
    };

    // Extract color from pill name (e.g. "Blue Pill", "Grön Pill", "Pill Blå")
    const extractColor = (name: string): string => {
      const nameLower = name.toLowerCase();
      for (const [colorName, hexValue] of Object.entries(colorMap)) {
        if (nameLower.includes(colorName)) {
          return hexValue;
        }
      }
      return '#1f2937'; // default to dark gray if no color found
    };

    // Prepare Pills data for upsert
    const pillsData = pills.map((pill: any) => {
      const batteryLevel = Math.round(pill.battery || 0);
      console.log(`Pill ${pill.name}: battery=${pill.battery}, rounded=${batteryLevel}`);
      
      return {
        pill_id: pill.id,
        name: pill.name || 'Unknown Pill',
        color: extractColor(pill.name || ''),
        battery_level: batteryLevel,
        last_update: pill.lastActivityTime ? new Date(pill.lastActivityTime).toISOString() : new Date().toISOString(),
      };
    });

    // Upsert Pills data
    if (pillsData.length > 0) {
      const { error: upsertError } = await supabase
        .from('rapt_pills')
        .upsert(pillsData, { onConflict: 'pill_id' });

      if (upsertError) {
        throw new Error(`Failed to upsert Pills data: ${upsertError.message}`);
      }

      console.log(`Successfully synced ${pillsData.length} Pills`);
    }

    // Prepare Temperature Controllers data for upsert
    const controllersData = controllers.map((controller: any) => {
      return {
        controller_id: controller.id,
        name: controller.name || 'Unknown Controller',
        current_temp: controller.temperature || null,
        pill_temp: controller.controlDeviceTemperature || null,
        target_temp: controller.targetTemperature || null,
        cooling_enabled: controller.coolingEnabled || false,
        heating_enabled: controller.heatingEnabled || false,
        heating_utilisation: controller.heatingUtilisation || 0,
        cooling_hysteresis: controller.coolingHysteresis ?? 0.2,
        heating_hysteresis: controller.heatingHysteresis ?? 0.2,
        last_update: controller.lastActivityTime ? new Date(controller.lastActivityTime).toISOString() : new Date().toISOString(),
      };
    });

    // Upsert Temperature Controllers data
    if (controllersData.length > 0) {
      const { error: controllersUpsertError } = await supabase
        .from('rapt_temp_controllers')
        .upsert(controllersData, { onConflict: 'controller_id' });

      if (controllersUpsertError) {
        console.error(`Failed to upsert Temperature Controllers data: ${controllersUpsertError.message}`);
      } else {
        console.log(`Successfully synced ${controllersData.length} Temperature Controllers`);
        
        // Auto-add new controllers to selected_rapt_temp_controllers
        const { data: existingSelected } = await supabase
          .from('selected_rapt_temp_controllers')
          .select('controller_id');
        
        const existingIds = new Set(existingSelected?.map((s: any) => s.controller_id) || []);
        const newControllers = controllersData.filter((c: any) => !existingIds.has(c.controller_id));
        
        if (newControllers.length > 0) {
          // Get the highest display_order
          const { data: maxOrder } = await supabase
            .from('selected_rapt_temp_controllers')
            .select('display_order')
            .order('display_order', { ascending: false })
            .limit(1);
          
          let nextOrder = (maxOrder && maxOrder.length > 0) ? maxOrder[0].display_order + 1 : 1;
          
          const newSelectedControllers = newControllers.map((c: any) => ({
            controller_id: c.controller_id,
            is_visible: true,
            display_order: nextOrder++
          }));
          
          const { error: insertError } = await supabase
            .from('selected_rapt_temp_controllers')
            .insert(newSelectedControllers);
          
          if (insertError) {
            console.error(`Failed to add new controllers to selection: ${insertError.message}`);
          } else {
            console.log(`Auto-added ${newControllers.length} new controllers to selection`);
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        pillsCount: pillsData.length,
        controllersCount: controllersData.length
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in sync-rapt-data function:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
