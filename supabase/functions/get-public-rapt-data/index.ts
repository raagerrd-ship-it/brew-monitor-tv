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
    console.log('Fetching public RAPT data...');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
