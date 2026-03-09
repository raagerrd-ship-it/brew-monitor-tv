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
    const rawBrewId = url.searchParams.get('brew_id');
    // Sanitize: only allow alphanumeric, hyphens, underscores (UUIDs, share_ids, batch_ids)
    const brewId = rawBrewId && /^[a-zA-Z0-9_-]{1,100}$/.test(rawBrewId) ? rawBrewId : null;
    if (rawBrewId && !brewId) {
      return new Response(
        JSON.stringify({ error: 'Invalid brew_id format', success: false }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // If brew_id is provided, fetch a specific brew (for shared brew pages)
    if (brewId) {
      console.log('Fetching public brew data for id:', brewId);

      // Single query with .or() instead of 3 sequential lookups
      const { data: brew } = await supabase
        .from('brew_readings')
        .select('*')
        .or(`share_id.eq.${brewId},batch_id.eq.${brewId},id.eq.${brewId}`)
        .limit(1)
        .maybeSingle();

      if (!brew) {
        return new Response(
          JSON.stringify({ error: 'Brew not found', success: false }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Fetch related data in parallel
      const [eventsRes, pillsRes, controllersRes, sessionRes, coolingSettingsRes] = await Promise.all([
        supabase
          .from('brew_events')
          .select('*')
          .eq('brew_id', brew.id)
          .order('event_date'),
        supabase
          .from('rapt_pills')
          .select('id, pill_id, name, color, battery_level, last_update, paired_device_id'),
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
          .maybeSingle(),
        supabase
          .from('auto_cooling_settings')
          .select('pill_compensation_enabled')
          .limit(1)
          .single()
      ]);

      console.log(`Successfully fetched brew: ${brew.name}`);

      return new Response(
        JSON.stringify({
          brew,
          events: eventsRes.data || [],
          pills: pillsRes.data || [],
          controllers: controllersRes.data || [],
          fermentationSession: sessionRes.data || null,
          pillCompEnabled: coolingSettingsRes.data?.pill_compensation_enabled ?? false,
          success: true
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Default behavior: fetch all selected RAPT data
    console.log('Fetching public RAPT data...');

    // Fetch selected controllers and pills in parallel
    const [
      { data: selectedControllers, error: selectedControllersError },
      { data: selectedPills, error: selectedPillsError },
    ] = await Promise.all([
      supabase
        .from('selected_rapt_temp_controllers')
        .select('controller_id')
        .eq('is_visible', true)
        .order('display_order'),
      supabase
        .from('selected_rapt_pills')
        .select('pill_id')
        .eq('is_visible', true)
        .order('display_order'),
    ]);

    if (selectedControllersError) throw selectedControllersError;
    if (selectedPillsError) throw selectedPillsError;

    const selectedControllerIds = selectedControllers?.map(s => s.controller_id) || [];
    const selectedPillIds = selectedPills?.map(s => s.pill_id) || [];

    // Fetch controllers and pills data in parallel
    const [controllersResult, pillsResult] = await Promise.all([
      selectedControllerIds.length > 0
        ? supabase.from('rapt_temp_controllers').select('*').in('controller_id', selectedControllerIds)
        : Promise.resolve({ data: [], error: null }),
      selectedPillIds.length > 0
        ? supabase.from('rapt_pills').select('*').in('pill_id', selectedPillIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (controllersResult.error) throw controllersResult.error;
    if (pillsResult.error) throw pillsResult.error;

    const controllers = (controllersResult.data || []).sort((a, b) =>
      selectedControllerIds.indexOf(a.controller_id) - selectedControllerIds.indexOf(b.controller_id)
    );
    const pills = (pillsResult.data || []).sort((a, b) =>
      selectedPillIds.indexOf(a.pill_id) - selectedPillIds.indexOf(b.pill_id)
    );

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
