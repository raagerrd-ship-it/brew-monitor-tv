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
      return {
        pill_id: pill.id,
        name: pill.name || 'Unknown Pill',
        color: extractColor(pill.name || ''),
        battery_level: pill.batteryLevel || 0,
        last_update: pill.lastActivity ? new Date(pill.lastActivity).toISOString() : new Date().toISOString(),
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

    return new Response(
      JSON.stringify({ 
        success: true, 
        pillsCount: pillsData.length 
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
