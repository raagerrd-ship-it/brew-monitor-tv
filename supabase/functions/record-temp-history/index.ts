import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Recording temperature history...');

    // Get all visible controllers
    const { data: selectedControllers, error: selectedError } = await supabase
      .from('selected_rapt_temp_controllers')
      .select('controller_id')
      .eq('is_visible', true);

    if (selectedError || !selectedControllers || selectedControllers.length === 0) {
      console.log('No visible controllers found');
      return new Response(JSON.stringify({ message: 'No visible controllers' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const visibleControllerIds = selectedControllers.map(c => c.controller_id);

    // Get current data for these controllers — just read what's there, no calculations
    const { data: controllers, error: controllersError } = await supabase
      .from('rapt_temp_controllers')
      .select('controller_id, pill_temp, current_temp, target_temp, cooling_enabled, profile_target_temp')
      .in('controller_id', visibleControllerIds);

    if (controllersError || !controllers) {
      throw new Error('Failed to fetch controller data');
    }

    console.log(`Recording history for ${controllers.length} controllers`);

    // Insert history records — purely reading stored values, zero calculations
    const historyRecords = controllers.map(c => ({
      controller_id: c.controller_id,
      current_temp: c.current_temp ?? c.pill_temp,
      target_temp: c.target_temp,
      cooling_enabled: c.cooling_enabled || false,
      profile_target_temp: c.profile_target_temp ?? c.target_temp,
    }));

    const { error: insertError } = await supabase
      .from('temp_controller_history')
      .insert(historyRecords);

    if (insertError) {
      console.error('Failed to insert history:', insertError);
      throw insertError;
    }

    // Record delta history for controllers that have both pill_temp and current_temp
    const deltaRecords = controllers
      .filter(c => c.pill_temp !== null && c.current_temp !== null)
      .map(c => ({
        controller_id: c.controller_id,
        pill_temp: c.pill_temp,
        controller_temp: c.current_temp,
        delta: c.pill_temp - c.current_temp,
      }));

    if (deltaRecords.length > 0) {
      const { error: deltaError } = await supabase
        .from('temp_delta_history')
        .insert(deltaRecords);

      if (deltaError) {
        console.error('Failed to insert delta history:', deltaError);
      } else {
        console.log(`Recorded ${deltaRecords.length} delta history entries`);
      }
    }

    const profileCount = controllers.filter(c => c.profile_target_temp != null).length;
    console.log(`Successfully recorded temperature history (${profileCount} with profile targets)`);

    return new Response(JSON.stringify({ 
      success: true,
      recorded: historyRecords.length 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in record-temp-history function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
