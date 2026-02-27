import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isSensorDataStale } from '../_shared/temp-utils.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

interface ControllerHealth {
  name: string
  controller_id: string
  current_temp: number | null
  target_temp: number | null
  profile_target_temp: number | null
  cooling_enabled: boolean
  heating_enabled: boolean
  is_glycol_cooler: boolean
  last_update: string | null
  stale: boolean
  stale_minutes: number | null
  linked_pill_id: string | null
}

interface SessionHealth {
  id: string
  controller_id: string
  controller_name: string | null
  profile_id: string
  brew_id: string | null
  status: string
  current_step_index: number
  step_started_at: string
  step_elapsed_hours: number
  started_at: string
  total_elapsed_hours: number
}

interface SystemHealth {
  timestamp: string
  overall_status: 'healthy' | 'warning' | 'critical'
  issues: string[]
  controllers: ControllerHealth[]
  active_sessions: SessionHealth[]
  summary: {
    total_controllers: number
    stale_controllers: number
    active_sessions: number
    controllers_without_sessions: number
    sessions_with_stale_controllers: number
    longest_step_hours: number | null
    duplicate_controller_sessions: string[]
  }
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

    const issues: string[] = []

    // Build controller map for name lookups
    const controllerNameMap = new Map<string, string>()
    if (controllers) {
      for (const c of controllers) {
        controllerNameMap.set(c.controller_id, c.name)
      }
    }

    // Process controllers
    const controllerHealthList: ControllerHealth[] = (controllers ?? []).map(c => {
      const staleCheck = isSensorDataStale(c.last_update)
      return {
        name: c.name,
        controller_id: c.controller_id,
        current_temp: c.current_temp ? parseFloat(String(c.current_temp)) : null,
        target_temp: c.target_temp ? parseFloat(String(c.target_temp)) : null,
        profile_target_temp: c.profile_target_temp ? parseFloat(String(c.profile_target_temp)) : null,
        cooling_enabled: c.cooling_enabled ?? false,
        heating_enabled: c.heating_enabled ?? false,
        is_glycol_cooler: c.is_glycol_cooler ?? false,
        last_update: c.last_update,
        stale: staleCheck.stale,
        stale_minutes: staleCheck.ageMinutes,
        linked_pill_id: c.linked_pill_id,
      }
    })

    const staleControllers = controllerHealthList.filter(c => c.stale && !c.is_glycol_cooler)

    // Process sessions
    const sessionHealthList: SessionHealth[] = (sessions ?? []).map(s => {
      const stepElapsed = Math.max(0, (now - new Date(s.step_started_at).getTime()) / (1000 * 60 * 60))
      const totalElapsed = Math.max(0, (now - new Date(s.started_at).getTime()) / (1000 * 60 * 60))
      return {
        id: s.id,
        controller_id: s.controller_id,
        controller_name: controllerNameMap.get(s.controller_id) ?? null,
        profile_id: s.profile_id,
        brew_id: s.brew_id,
        status: s.status,
        current_step_index: s.current_step_index,
        step_started_at: s.step_started_at,
        step_elapsed_hours: Math.round(stepElapsed * 10) / 10,
        started_at: s.started_at,
        total_elapsed_hours: Math.round(totalElapsed * 10) / 10,
      }
    })

    // Detect duplicate controller sessions
    const controllerSessionCount = new Map<string, string[]>()
    for (const s of sessionHealthList) {
      const list = controllerSessionCount.get(s.controller_id) || []
      list.push(s.id)
      controllerSessionCount.set(s.controller_id, list)
    }
    const duplicateControllerSessions = [...controllerSessionCount.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([cid]) => controllerNameMap.get(cid) ?? cid)

    // Sessions with stale controllers
    const sessionsWithStale = sessionHealthList.filter(s =>
      staleControllers.some(c => c.controller_id === s.controller_id)
    )

    // Longest running step
    const longestStep = sessionHealthList.length > 0
      ? Math.max(...sessionHealthList.map(s => s.step_elapsed_hours))
      : null

    // Build issues list
    if (staleControllers.length > 0) {
      for (const c of staleControllers) {
        issues.push(`Controller "${c.name}" har ingen data sedan ${c.stale_minutes ?? '?'} minuter`)
      }
    }
    if (duplicateControllerSessions.length > 0) {
      issues.push(`Controllerkollision: ${duplicateControllerSessions.join(', ')} har flera aktiva sessioner`)
    }
    if (sessionsWithStale.length > 0) {
      issues.push(`${sessionsWithStale.length} aktiv(a) session(er) med stale controller-data`)
    }
    if (longestStep !== null && longestStep > 24 * 7) {
      issues.push(`Steg har kört i ${Math.round(longestStep / 24)} dagar — kan vara fastnat`)
    }

    // Unread warning notifications
    const unreadWarnings = recentNotifs?.length ?? 0
    if (unreadWarnings > 0) {
      issues.push(`${unreadWarnings} olästa varningsnotiser senaste 24h`)
    }

    // Overall status
    let overallStatus: 'healthy' | 'warning' | 'critical' = 'healthy'
    if (duplicateControllerSessions.length > 0 || sessionsWithStale.length > 0) {
      overallStatus = 'critical'
    } else if (staleControllers.length > 0 || (longestStep !== null && longestStep > 24 * 3) || unreadWarnings > 3) {
      overallStatus = 'warning'
    }

    const health: SystemHealth = {
      timestamp: new Date().toISOString(),
      overall_status: overallStatus,
      issues,
      controllers: controllerHealthList,
      active_sessions: sessionHealthList,
      summary: {
        total_controllers: controllerHealthList.length,
        stale_controllers: staleControllers.length,
        active_sessions: sessionHealthList.length,
        controllers_without_sessions: controllerHealthList.filter(c =>
          !c.is_glycol_cooler && !sessionHealthList.some(s => s.controller_id === c.controller_id)
        ).length,
        sessions_with_stale_controllers: sessionsWithStale.length,
        longest_step_hours: longestStep,
        duplicate_controller_sessions: duplicateControllerSessions,
      },
    }

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
