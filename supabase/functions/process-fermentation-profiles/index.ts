import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ProfileStep } from '../_shared/temp-utils.ts'
import { processStep, StepContext, SgDataPoint } from '../_shared/step-handlers.ts'
import { completeProfile, advanceToNextStep } from '../_shared/session-lifecycle.ts'
import type { FermentationSession, BrewData, FermentationMetrics } from '../_shared/types.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
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

function buildBrewDataMap(allBrewData: any[] | null): Map<string, BrewData> {
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

function buildMetricsMap(allMetrics: any[] | null): Map<string, FermentationMetrics> {
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

    const typedSessions = sessions as FermentationSession[]
    const results: { sessionId: string; action: string; details: any }[] = []

    // ---- SAFETY: Detect duplicate controllers (two sessions on same controller) ----
    const controllerSessionMap = new Map<string, string[]>()
    for (const s of typedSessions) {
      const list = controllerSessionMap.get(s.controller_id) || []
      list.push(s.id)
      controllerSessionMap.set(s.controller_id, list)
    }
    for (const [controllerId, sessionIds] of controllerSessionMap) {
      if (sessionIds.length > 1) {
        console.error(`🚨 CONFLICT: ${sessionIds.length} sessions targeting controller ${controllerId}: ${sessionIds.join(', ')}`)
        await supabase.from('pending_notifications').insert({
          type: 'controller_conflict',
          title: 'Controllerkollision',
          body: `${sessionIds.length} aktiva sessioner styr samma controller (${controllerId}). Bara en session bör vara aktiv per controller.`,
          controller_id: controllerId,
        })
      }
    }

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

    // ---- Process each session (with per-session error isolation) ----
    for (const session of typedSessions) {
      try {
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

        // SAFETY: Check if controller data is stale before processing
        const controller = controllerMap.get(session.controller_id) ?? null
        if (controller) {
          const lastUpdate = controller.last_update
          if (lastUpdate) {
            const ageMs = Date.now() - new Date(lastUpdate).getTime()
            const ageMinutes = Math.round(ageMs / 60000)
            if (ageMs > 60 * 60 * 1000) {
              // More than 60 min stale — skip step transitions that depend on temp
              console.warn(`⚠️ Session ${session.id}: Controller ${controller.name} data is ${ageMinutes}min old — skipping temp-dependent transitions`)
              results.push({ sessionId: session.id, action: 'stale_sensor_skip', details: { age_minutes: ageMinutes, controller: controller.name } })
              continue
            }
          }
        }

        // Build step context
        const brewData = session.brew_id ? (brewDataMap.get(session.brew_id) ?? null) : null
        const metrics = session.brew_id ? (metricsMap.get(session.brew_id) ?? null) : null
        const elapsedHours = Math.max(0, (Date.now() - new Date(session.step_started_at).getTime()) / (1000 * 60 * 60))

        // SAFETY: Max step duration guard (7 days) — prevent infinite stuck sessions
        const MAX_STEP_HOURS = 7 * 24 // 7 days
        if (elapsedHours > MAX_STEP_HOURS && currentStep.step_type !== 'wait_for_acknowledgement') {
          console.error(`🚨 Session ${session.id}: Step ${session.current_step_index} (${currentStep.step_type}) has been running for ${Math.round(elapsedHours)}h — exceeds ${MAX_STEP_HOURS}h safety limit`)
          await supabase.from('pending_notifications').insert({
            type: 'step_timeout',
            title: 'Steg fastnat',
            body: `Steg ${session.current_step_index} (${currentStep.step_type}) har körts i ${Math.round(elapsedHours / 24)} dagar utan att slutföras. Kontrollera manuellt.`,
            controller_id: session.controller_id,
            brew_id: session.brew_id,
          })
          results.push({ sessionId: session.id, action: 'step_timeout_warning', details: { elapsed_hours: Math.round(elapsedHours), step_type: currentStep.step_type } })
          // Don't skip — just alert. The operator decides.
        }

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
            // SAFETY: Verify target temp jump is within reasonable bounds before advancing
            const nextStep = steps[nextStepIndex] as ProfileStep | undefined
            const currentTarget = controller?.target_temp ? parseFloat(String(controller.target_temp)) : null
            const nextTarget = nextStep?.target_temp ?? null
            if (currentTarget !== null && nextTarget !== null) {
              const tempJump = Math.abs(nextTarget - currentTarget)
              if (tempJump > 25) {
                console.error(`🚨 SAFETY BLOCK: Step ${session.current_step_index}→${nextStepIndex} would jump ${tempJump.toFixed(1)}°C (${currentTarget}→${nextTarget}°C). Blocking for safety.`)
                results.push({ sessionId: session.id, action: 'safety_blocked', details: { temp_jump: tempJump, from: currentTarget, to: nextTarget } })
                continue
              }
            }

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
      } catch (sessionError) {
        // Per-session error isolation: log and continue with other sessions
        const errorMsg = sessionError instanceof Error ? sessionError.message : String(sessionError)
        console.error(`🚨 Session ${session.id} error (controller ${session.controller_id}): ${errorMsg}`)
        results.push({ sessionId: session.id, action: 'error', details: { error: errorMsg } })
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
