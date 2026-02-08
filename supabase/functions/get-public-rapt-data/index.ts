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
    const url = new URL(req.url);
    const brewId = url.searchParams.get('brew_id');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // If brew_id is provided, fetch a specific brew (for shared brew pages)
    if (brewId) {
      console.log('Fetching public brew data for id:', brewId);

      // Try to find by share_id first, then batch_id, then id (UUID)
      let brew = null;

      // Try share_id
      const { data: byShareId } = await supabase
        .from('brew_readings')
        .select('*')
        .eq('share_id', brewId)
        .maybeSingle();

      if (byShareId) {
        brew = byShareId;
      } else {
        // Try batch_id
        const { data: byBatchId } = await supabase
          .from('brew_readings')
          .select('*')
          .eq('batch_id', brewId)
          .maybeSingle();

        if (byBatchId) {
          brew = byBatchId;
        } else {
          // Try UUID id
          const { data: byId } = await supabase
            .from('brew_readings')
            .select('*')
            .eq('id', brewId)
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
    }

    // Default behavior: fetch all selected RAPT data
    console.log('Fetching public RAPT data...');

    // Get selected controllers
    const { data: selectedControllers, error: selectedControllersError } = await supabase
      .from('selected_rapt_temp_controllers')
      .select('controller_id')
      .eq('is_visible', true)
      .order('display_order');

    if (selectedControllersError) {
      console.error('Error fetching selected controllers:', selectedControllersError);
      throw selectedControllersError;
    }

    const selectedControllerIds = selectedControllers?.map(s => s.controller_id) || [];

    // Get selected pills
    const { data: selectedPills, error: selectedPillsError } = await supabase
      .from('selected_rapt_pills')
      .select('pill_id')
      .eq('is_visible', true)
      .order('display_order');

    if (selectedPillsError) {
      console.error('Error fetching selected pills:', selectedPillsError);
      throw selectedPillsError;
    }

    const selectedPillIds = selectedPills?.map(s => s.pill_id) || [];

    // Fetch controllers data
    let controllers = [];
    if (selectedControllerIds.length > 0) {
      const { data: controllersData, error: controllersError } = await supabase
        .from('rapt_temp_controllers')
        .select('*')
        .in('controller_id', selectedControllerIds);

      if (controllersError) {
        console.error('Error fetching controllers:', controllersError);
        throw controllersError;
      }

      // Sort by selected order
      controllers = (controllersData || []).sort((a, b) => {
        const aIndex = selectedControllerIds.indexOf(a.controller_id);
        const bIndex = selectedControllerIds.indexOf(b.controller_id);
        return aIndex - bIndex;
      });
    }

    // Fetch pills data
    let pills = [];
    if (selectedPillIds.length > 0) {
      const { data: pillsData, error: pillsError } = await supabase
        .from('rapt_pills')
        .select('*')
        .in('pill_id', selectedPillIds);

      if (pillsError) {
        console.error('Error fetching pills:', pillsError);
        throw pillsError;
      }

      // Sort by selected order
      pills = (pillsData || []).sort((a, b) => {
        const aIndex = selectedPillIds.indexOf(a.pill_id);
        const bIndex = selectedPillIds.indexOf(b.pill_id);
        return aIndex - bIndex;
      });
    }

    console.log(`Successfully fetched ${controllers.length} controllers and ${pills.length} pills`);

    return new Response(
      JSON.stringify({
        controllers,
        pills,
        success: true
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in get-public-rapt-data function:', error);
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
