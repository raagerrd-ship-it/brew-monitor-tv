import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ProfileStep } from '../_shared/temp-utils.ts'
import { processStep, StepContext, SgDataPoint } from '../_shared/step-handlers.ts'
import { completeProfile, advanceToNextStep } from '../_shared/session-lifecycle.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

interface Session {
  id: string
  profile_id: string
  brew_id: string | null
  controller_id: string
  status: string
  current_step_index: number
  step_started_at: string
  step_start_temp: number | null
  started_at: string
  ramp_triggered_at: string | null
}

// ─── Batch data helpers ───────────────────────────────────────────────

function buildStepsMap(allSteps: any[] | null): Map<string, any[]> {
  const map = new Map<string, any[]>()
  if (allSteps) {
    for (const step of allSteps) {
      const list = map.get(step.profile_id) || []
      list.push(step)
      map.set(step.profile_id, list)
    }
  }
  return map
}

function buildControllerMap(allControllers: any[] | null): Map<string, any> {
  const map = new Map<string, any>()
  if (allControllers) {
    for (const c of allControllers) {
      map.set(c.controller_id, c)
    }
  }
  return map
}

function buildBrewDataMap(allBrewData: any[] | null): Map<string, { sg_data: SgDataPoint[]; original_gravity: number; final_gravity: number }> {
  const map = new Map()
  if (allBrewData) {
    for (const b of allBrewData) {
      map.set(b.id, {
        sg_data: b.sg_data as SgDataPoint[],
        original_gravity: parseFloat(String(b.original_gravity ?? 0)),
        final_gravity: parseFloat(String(b.final_gravity ?? 0)),
      })
    }
  }
  return map
}

function buildMetricsMap(allMetrics: any[] | null): Map<string, { fermentation_phase: string; activity_score: number; sg_rate_per_hour: number; eta_to_fg_hours: number | null; ready_to_crash: boolean }> {
  const map = new Map()
  if (allMetrics) {
    for (const m of allMetrics) {
      map.set(m.brew_id, {
        fermentation_phase: m.fermentation_phase,
        activity_score: parseFloat(String(m.activity_score)),
        sg_rate_per_hour: parseFloat(String(m.sg_rate_per_hour)),
        eta_to_fg_hours: m.eta_to_fg_hours ? parseFloat(String(m.eta_to_fg_hours)) : null,
        ready_to_crash: m.ready_to_crash,
      })
    }
  }
  return map
}

// ─── Main handler ─────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Get all running sessions
    const { data: sessions, error: sessionsError } = await supabase
      .from('fermentation_sessions')
      .select('*')
      .eq('status', 'running')

    if (sessionsError) {
      throw new Error(`Failed to fetch sessions: ${sessionsError.message}`)
    }

    if (!sessions || sessions.length === 0) {
      return new Response(JSON.stringify({ message: 'No active sessions' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const typedSessions = sessions as Session[]
    const results: { sessionId: string; action: string; details: any }[] = []

    // ---- Batch pre-fetch ----
    const uniqueProfileIds = [...new Set(typedSessions.map(s => s.profile_id))]
    const uniqueControllerIds = [...new Set(typedSessions.map(s => s.controller_id))]
    const brewIds = typedSessions.map(s => s.brew_id).filter((id): id is string => id !== null)

    const [
      { data: allSteps },
      { data: allControllers },
      { data: allBrewData },
      { data: allMetrics },
    ] = await Promise.all([
      supabase
        .from('fermentation_profile_steps')
        .select('*')
        .in('profile_id', uniqueProfileIds)
        .order('step_order', { ascending: true }),
      supabase
        .from('rapt_temp_controllers')
        .select('*')
        .in('controller_id', uniqueControllerIds),
      brewIds.length > 0
        ? supabase.from('brew_readings').select('id, sg_data, original_gravity, final_gravity').in('id', brewIds)
        : Promise.resolve({ data: null } as { data: null }),
      brewIds.length > 0
        ? supabase.from('brew_fermentation_metrics').select('brew_id, fermentation_phase, activity_score, sg_rate_per_hour, eta_to_fg_hours, ready_to_crash').in('brew_id', brewIds)
        : Promise.resolve({ data: null } as { data: null }),
    ])

    const stepsMap = buildStepsMap(allSteps)
    const controllerMap = buildControllerMap(allControllers)
    const brewDataMap = buildBrewDataMap(allBrewData as any[] | null)
    const metricsMap = buildMetricsMap(allMetrics as any[] | null)

    // ---- Process each session ----
    for (const session of typedSessions) {
      const steps = stepsMap.get(session.profile_id)
      if (!steps || steps.length === 0) {
        console.error(`No steps found for profile ${session.profile_id}`)
        continue
      }

      const currentStep = steps[session.current_step_index] as ProfileStep

      // All steps completed (index past end)
      if (!currentStep) {
        await completeProfile(supabase, session, session.current_step_index)
        results.push({ sessionId: session.id, action: 'completed', details: {} })
        continue
      }

      // Build step context
      const controller = controllerMap.get(session.controller_id) ?? null
      const brewData = session.brew_id ? (brewDataMap.get(session.brew_id) ?? null) : null
      const metrics = session.brew_id ? (metricsMap.get(session.brew_id) ?? null) : null
      const elapsedHours = (Date.now() - new Date(session.step_started_at).getTime()) / (1000 * 60 * 60)

      const ctx: StepContext = {
        supabase, session, currentStep,
        steps: steps as ProfileStep[],
        controller, brewData, metrics, elapsedHours,
      }

      // Process the current step
      const { stepCompleted, actionTaken, actionDetails } = await processStep(ctx)

      // Log action if something happened
      if (actionTaken !== 'checked') {
        await supabase.from('fermentation_step_log').insert({
          session_id: session.id,
          step_index: session.current_step_index,
          action: actionTaken,
          details: actionDetails,
        })
      }

      // Advance to next step if completed
      if (stepCompleted) {
        const nextStepIndex = session.current_step_index + 1

        if (nextStepIndex >= steps.length) {
          // Profile complete
          await completeProfile(supabase, session, nextStepIndex)
          results.push({ sessionId: session.id, action: 'profile_completed', details: {} })
        } else {
          // Advance
          await advanceToNextStep(
            supabase, session.id, session.controller_id,
            nextStepIndex, steps as ProfileStep[], currentStep.step_type,
          )
          results.push({
            sessionId: session.id,
            action: 'step_advanced',
            details: {
              from: session.current_step_index,
              to: nextStepIndex,
              new_step_type: steps[nextStepIndex]?.step_type || 'unknown',
            },
          })
        }
      } else {
        results.push({ sessionId: session.id, action: actionTaken, details: actionDetails })
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error processing fermentation profiles:', error)
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
