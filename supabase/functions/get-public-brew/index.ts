import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return new Response(
        JSON.stringify({ error: 'Missing id parameter', success: false }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Fetching public brew data for id:', id);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Try to find by share_id first, then batch_id, then id (UUID)
    let brew = null;

    // Try share_id
    const { data: byShareId } = await supabase
      .from('brew_readings')
      .select('*')
      .eq('share_id', id)
      .maybeSingle();

    if (byShareId) {
      brew = byShareId;
    } else {
      // Try batch_id
      const { data: byBatchId } = await supabase
        .from('brew_readings')
        .select('*')
        .eq('batch_id', id)
        .maybeSingle();

      if (byBatchId) {
        brew = byBatchId;
      } else {
        // Try UUID id
        const { data: byId } = await supabase
          .from('brew_readings')
          .select('*')
          .eq('id', id)
          .maybeSingle();

        if (byId) {
          brew = byId;
        }
      }
    }

    if (!brew) {
      return new Response(
        JSON.stringify({ error: 'Brew not found', success: false }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch related data in parallel
    const [eventsRes, pillsRes, controllersRes, sessionRes] = await Promise.all([
      supabase
        .from('brew_events')
        .select('*')
        .eq('brew_id', brew.id)
        .order('event_date'),
      supabase
        .from('rapt_pills')
        .select('id, pill_id, name, color, battery_level, last_update'),
      supabase
        .from('rapt_temp_controllers')
        .select('id, controller_id, name, current_temp, pill_temp, target_temp, last_update, min_target_temp, max_target_temp, cooling_enabled, heating_enabled, heating_utilisation, linked_pill_id'),
      supabase
        .from('fermentation_sessions')
        .select(`
          id,
          profile_id,
          controller_id,
          brew_id,
          current_step_index,
          step_started_at,
          step_start_temp,
          status,
          started_at,
          completed_at,
          fermentation_profiles (
            id,
            name,
            description,
            fermentation_profile_steps (
              id,
              step_order,
              step_type,
              target_temp,
              duration_hours,
              gravity_stable_days,
              gravity_threshold,
              target_sg,
              sg_comparison,
              ramp_type,
              notes
            )
          )
        `)
        .eq('brew_id', brew.id)
        .eq('status', 'running')
        .maybeSingle()
    ]);

    console.log(`Successfully fetched brew: ${brew.name}`);

    return new Response(
      JSON.stringify({
        brew,
        events: eventsRes.data || [],
        pills: pillsRes.data || [],
        controllers: controllersRes.data || [],
        fermentationSession: sessionRes.data || null,
        success: true
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in get-public-brew function:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
