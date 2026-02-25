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

    // Get current data for these controllers
    const { data: controllers, error: controllersError } = await supabase
      .from('rapt_temp_controllers')
      .select('controller_id, pill_temp, current_temp, target_temp, cooling_enabled')
      .in('controller_id', visibleControllerIds);

    if (controllersError || !controllers) {
      throw new Error('Failed to fetch controller data');
    }

    console.log(`Recording history for ${controllers.length} controllers`);

    // Look up fermentation profile targets for each controller
    const profileTargetMap = await getProfileTargets(supabase, visibleControllerIds);

    // Insert history records
    const historyRecords = controllers.map(c => ({
      controller_id: c.controller_id,
      current_temp: c.current_temp ?? c.pill_temp,
      target_temp: c.target_temp,
      cooling_enabled: c.cooling_enabled || false,
      profile_target_temp: profileTargetMap[c.controller_id] ?? null,
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

    const profileCount = Object.values(profileTargetMap).filter(v => v !== null).length;
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

/**
 * Look up the current fermentation profile target for each controller.
 * Returns the base profile target (not the PID-adjusted one).
 * If no active profile session, returns the controller's fixed target_temp.
 */
async function getProfileTargets(
  supabase: any,
  controllerIds: string[]
): Promise<Record<string, number | null>> {
  const result: Record<string, number | null> = {};

  try {
    // Get running/paused fermentation sessions for these controllers
    const { data: sessions } = await supabase
      .from('fermentation_sessions')
      .select('id, controller_id, profile_id, started_at, current_step_index, step_started_at, step_start_temp')
      .in('controller_id', controllerIds)
      .in('status', ['running', 'paused']);

    if (!sessions || sessions.length === 0) {
      // No active sessions - use the fixed controller target
      const { data: controllers } = await supabase
        .from('rapt_temp_controllers')
        .select('controller_id, target_temp')
        .in('controller_id', controllerIds);

      if (controllers) {
        for (const c of controllers) {
          result[c.controller_id] = c.target_temp;
        }
      }
      return result;
    }

    // For each active session, get the current step's target
    for (const session of sessions) {
      const { data: steps } = await supabase
        .from('fermentation_profile_steps')
        .select('step_order, target_temp, step_type')
        .eq('profile_id', session.profile_id)
        .order('step_order', { ascending: true });

      if (!steps || steps.length === 0) continue;

      // Get the current step's target
      const currentStep = steps.find((s: any) => s.step_order === session.current_step_index);
      if (currentStep?.target_temp != null) {
        // For ramp steps, calculate the interpolated target
        if (currentStep.step_type === 'ramp') {
          const interpTarget = getRampInterpolatedTarget(session, currentStep);
          result[session.controller_id] = interpTarget ?? currentStep.target_temp;
        } else {
          result[session.controller_id] = currentStep.target_temp;
        }
      } else {
        // Fall back to previous step with a target
        let target: number | null = null;
        for (let i = session.current_step_index; i >= 0; i--) {
          const step = steps.find((s: any) => s.step_order === i);
          if (step?.target_temp != null) {
            target = step.target_temp;
            break;
          }
        }
        result[session.controller_id] = target;
      }
    }

    // For controllers without an active session, use fixed target
    for (const cid of controllerIds) {
      if (!(cid in result)) {
        const { data: ctrl } = await supabase
          .from('rapt_temp_controllers')
          .select('target_temp')
          .eq('controller_id', cid)
          .single();
        result[cid] = ctrl?.target_temp ?? null;
      }
    }
  } catch (err) {
    console.error('Error fetching profile targets:', err);
    // Return empty map on error - profile_target_temp will be null
  }

  return result;
}

/**
 * For a ramp step, interpolate the target using session.step_started_at and session.step_start_temp.
 * Matches the logic in fermentation-target.ts, auto-adjust-cooling, and process-fermentation-profiles.
 */
function getRampInterpolatedTarget(
  session: any,
  currentStep: any
): number | null {
  if (session.step_start_temp == null || !currentStep.duration_hours || currentStep.target_temp == null) {
    return currentStep.target_temp;
  }

  const stepStartTime = new Date(session.step_started_at).getTime();
  const elapsed = (Date.now() - stepStartTime) / (1000 * 60 * 60); // hours
  const progress = Math.min(1, elapsed / currentStep.duration_hours);
  const interpolated = session.step_start_temp + (currentStep.target_temp - session.step_start_temp) * progress;
  return Math.round(interpolated * 10) / 10;
}
