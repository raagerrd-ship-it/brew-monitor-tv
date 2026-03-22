import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { computeSystemHealth } from '../_shared/system-health-logic.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const now = Date.now()

    // Fetch all data in parallel
    const [
      { data: controllers },
      { data: sessions },
      { data: recentNotifs },
    ] = await Promise.all([
      supabase
        .from('rapt_temp_controllers')
        .select('controller_id, name, current_temp, target_temp, profile_target_temp, cooling_enabled, heating_enabled, is_glycol_cooler, last_update, linked_pill_id')
        .order('name'),
      supabase
        .from('fermentation_sessions')
        .select('id, controller_id, profile_id, brew_id, status, current_step_index, step_started_at, started_at')
        .eq('status', 'running'),
      supabase
        .from('pending_notifications')
        .select('type, created_at')
        .in('type', ['automation_failure', 'controller_conflict', 'step_timeout', 'sensor_offline', 'unknown_step_type'])
        .gte('created_at', new Date(now - 24 * 60 * 60 * 1000).toISOString())
        .is('read_at', null),
    ])

    const health = computeSystemHealth(
      controllers ?? [],
      sessions ?? [],
      recentNotifs ?? [],
    )

    return new Response(JSON.stringify(health), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Health check error:', error)
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
