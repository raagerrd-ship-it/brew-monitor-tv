import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ProfileStep } from './temp-utils.ts'
import { processStep, StepContext, SgDataPoint } from './step-handlers.ts'
import { completeProfile, advanceToNextStep } from './session-lifecycle.ts'
import type { FermentationSession, BrewData, FermentationMetrics } from './types.ts'
import { fetchSgDataBatch } from './types.ts'

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

function buildBrewDataMap(allBrewData: any[] | null, snapshotSgMap: Map<string, SgDataPoint[]>): Map<string, BrewData> {
  const map = new Map()
  if (allBrewData) {
    for (const b of allBrewData) {
      map.set(b.id, {
        sg_data: snapshotSgMap.get(b.id) || [],
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

// ─── Main exported function ───────────────────────────────────────────

export interface ProfilesResult {
  results: { sessionId: string; action: string; details: any }[]
  message?: string
}

export interface ProcessSessionsOpts {
  /** Pre-fetched running sessions — skips DB query if provided */
  sessions?: FermentationSession[]
  /** Pre-fetched controllers — skips DB query if provided */
  controllers?: any[]
  /** Pre-fetched brew_fermentation_metrics — skips DB query if provided */
  brewMetrics?: any[]
  /** Pre-fetched brew_readings rows — skips DB query if provided */
  brewReadings?: any[]
}

export async function processAllSessions(
  supabase: ReturnType<typeof createClient>,
  opts?: ProcessSessionsOpts,
): Promise<ProfilesResult> {
  // Get all running sessions (skip if injected)
  let typedSessions: FermentationSession[]
  if (opts?.sessions) {
    typedSessions = opts.sessions
  } else {
    const { data: sessions, error: sessionsError } = await supabase
      .from('fermentation_sessions')
      .select('*')
      .eq('status', 'running')
    if (sessionsError) {
      throw new Error(`Failed to fetch sessions: ${sessionsError.message}`)
    }
    if (!sessions || sessions.length === 0) {
      return { message: 'No active sessions', results: [] }
    }
    typedSessions = sessions as FermentationSession[]
  }

  if (typedSessions.length === 0) {
    return { message: 'No active sessions', results: [] }
  }
  const results: { sessionId: string; action: string; details: any }[] = []

  // SAFETY: Detect duplicate controllers
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

  // Batch pre-fetch
  const uniqueProfileIds = [...new Set(typedSessions.map(s => s.profile_id))]
  const uniqueControllerIds = [...new Set(typedSessions.map(s => s.controller_id))]
  const brewIds = typedSessions.map(s => s.brew_id).filter((id): id is string => id !== null)

  // Use injected controllers or fetch from DB
  const controllersPromise = opts?.controllers
    ? Promise.resolve({ data: opts.controllers.filter(c => uniqueControllerIds.includes(c.controller_id)) })
    : supabase.from('rapt_temp_controllers').select('*').in('controller_id', uniqueControllerIds)

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
    controllersPromise,
    opts?.brewReadings
      ? Promise.resolve({ data: opts.brewReadings.filter((b: any) => brewIds.includes(b.id)) })
      : (brewIds.length > 0
        ? supabase.from('brew_readings').select('id, original_gravity, final_gravity').in('id', brewIds)
        : Promise.resolve({ data: null } as { data: null })),
    opts?.brewMetrics
      ? Promise.resolve({ data: opts.brewMetrics.filter((m: any) => brewIds.includes(m.brew_id)) })
      : (brewIds.length > 0
        ? supabase.from('brew_fermentation_metrics').select('brew_id, fermentation_phase, activity_score, sg_rate_per_hour, eta_to_fg_hours, ready_to_crash').in('brew_id', brewIds)
        : Promise.resolve({ data: null } as { data: null })),
  ])

  // Fetch SG data from snapshots (SSOT)
  const snapshotSgMap = brewIds.length > 0
    ? await fetchSgDataBatch(supabase, brewIds)
    : new Map<string, SgDataPoint[]>()

  const stepsMap = buildStepsMap(allSteps)
  const controllerMap = buildControllerMap(allControllers)
  const brewDataMap = buildBrewDataMap(allBrewData as any[] | null, snapshotSgMap)
  const metricsMap = buildMetricsMap(allMetrics as any[] | null)

  // Process each session (with per-session error isolation)
  for (const session of typedSessions) {
    try {
      const steps = stepsMap.get(session.profile_id)
      if (!steps || steps.length === 0) {
        console.error(`No steps found for profile ${session.profile_id}`)
        continue
      }

      const currentStep = steps[session.current_step_index] as ProfileStep

      if (!currentStep) {
        await completeProfile(supabase, session, session.current_step_index)
        results.push({ sessionId: session.id, action: 'completed', details: {} })
        continue
      }

      // SAFETY: Check stale controller data
      const controller = controllerMap.get(session.controller_id) ?? null
      if (controller) {
        const lastUpdate = controller.last_update
        if (lastUpdate) {
          const ageMs = Date.now() - new Date(lastUpdate).getTime()
          const ageMinutes = Math.round(ageMs / 60000)
          if (ageMs > 60 * 60 * 1000) {
            console.warn(`⚠️ Session ${session.id}: Controller ${controller.name} data is ${ageMinutes}min old — skipping temp-dependent transitions`)
            results.push({ sessionId: session.id, action: 'stale_sensor_skip', details: { age_minutes: ageMinutes, controller: controller.name } })
            continue
          }
        }
      }

      const brewData = session.brew_id ? (brewDataMap.get(session.brew_id) ?? null) : null
      const metrics = session.brew_id ? (metricsMap.get(session.brew_id) ?? null) : null
      const elapsedHours = Math.max(0, (Date.now() - new Date(session.step_started_at).getTime()) / (1000 * 60 * 60))

      // SAFETY: Max step duration guard
      const MAX_STEP_HOURS = 7 * 24
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
      }

      const ctx: StepContext = {
        supabase, session, currentStep,
        steps: steps as ProfileStep[],
        controller, brewData, metrics, elapsedHours,
      }

      const { stepCompleted, actionTaken, actionDetails } = await processStep(ctx)

      if (actionTaken !== 'checked') {
        await supabase.from('fermentation_step_log').insert({
          session_id: session.id,
          step_index: session.current_step_index,
          action: actionTaken,
          details: actionDetails,
        })
      }

      if (stepCompleted) {
        const nextStepIndex = session.current_step_index + 1

        if (nextStepIndex >= steps.length) {
          await completeProfile(supabase, session, nextStepIndex)
          results.push({ sessionId: session.id, action: 'profile_completed', details: {} })
        } else {
          // SAFETY: Clamp next step target to controller range
          const nextStep = steps[nextStepIndex] as ProfileStep | undefined
          if (nextStep?.target_temp != null && controller) {
            const minTemp = controller.min_target_temp != null ? parseFloat(String(controller.min_target_temp)) : -5
            const maxTemp = controller.max_target_temp != null ? parseFloat(String(controller.max_target_temp)) : 25
            if (nextStep.target_temp < minTemp || nextStep.target_temp > maxTemp) {
              console.error(`🚨 SAFETY BLOCK: Step ${nextStepIndex} target ${nextStep.target_temp}°C is outside controller range [${minTemp}, ${maxTemp}°C]. Blocking.`)
              results.push({ sessionId: session.id, action: 'safety_blocked', details: { target: nextStep.target_temp, min: minTemp, max: maxTemp } })
              continue
            }
          }

          const currentProfileTarget = controller?.profile_target_temp ? parseFloat(String(controller.profile_target_temp)) : null
          await advanceToNextStep(
            supabase, session.id, session.controller_id,
            nextStepIndex, steps as ProfileStep[], currentStep.step_type, currentProfileTarget,
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
      const errorMsg = sessionError instanceof Error ? sessionError.message : String(sessionError)
      console.error(`🚨 Session ${session.id} error (controller ${session.controller_id}): ${errorMsg}`)
      results.push({ sessionId: session.id, action: 'error', details: { error: errorMsg } })
    }
  }

  return { results }
}
