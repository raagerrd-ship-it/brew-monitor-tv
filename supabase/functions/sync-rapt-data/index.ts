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
    console.log(`Received ${pills.length} Pills`);

    // Map color names to hex colors
    const colorMap: Record<string, string> = {
      'black': '#000000',
      'blue': '#3b82f6',
      'green': '#10b981',
      'orange': '#f97316',
      'pink': '#ec4899',
      'purple': '#a855f7',
      'red': '#ef4444',
      'yellow': '#eab308',
    };

    // Prepare Pills data for upsert
    const pillsData = pills.map((pill: any) => {
      const colorName = pill.colour?.toLowerCase() || 'black';
      return {
        pill_id: pill.id,
        name: pill.name || `Pill ${pill.colour}`,
        color: colorMap[colorName] || '#000000',
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
