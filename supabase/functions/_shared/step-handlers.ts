import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ProfileStep, TempController, getEffectiveTargetTemp } from './temp-utils.ts'
import { insertNotification } from './notifications.ts'
import {
  SgDataPoint, BrewData, FermentationMetrics, FermentationSession,
  StepContext, StepResult, setProfileTarget,
} from './types.ts'

// Re-export types used by consumers
export type { SgDataPoint, StepContext, StepResult }

// ─── Shared helpers ───────────────────────────────────────────────────

/** Create a default StepResult to reduce boilerplate across handlers */
function defaultResult(): { stepCompleted: boolean; actionTaken: string; actionDetails: any } {
  return { stepCompleted: false, actionTaken: 'checked', actionDetails: {} }
}

/** Get the latest SG value from sg_data, sorted newest first */
function getLatestSg(sgData: SgDataPoint[]): { value: number; date: string } | null {
  if (!sgData || sgData.length === 0) return null
  const sorted = [...sgData].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  return sorted[0]
}

/** Sort SG data newest first (returns new array) */
function sortSgDataDesc(sgData: SgDataPoint[]): SgDataPoint[] {
  return [...sgData].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

/**
 * Pick the correct sensor for temperature comparison based on direction.
 * Warming up → pill (surface heats first, more responsive)
 * Cooling down → probe (core cools first via glycol contact)
 */
function getDirectionalTemp(controller: TempController, targetTemp: number, referenceTemp: number): number | null {
  const rampingUp = targetTemp > referenceTemp
  return rampingUp
    ? (controller.pill_temp ?? controller.current_temp ?? null)
    : (controller.current_temp ?? controller.pill_temp ?? null)
}

export function isGravityStable(sgData: SgDataPoint[], stableDays: number, threshold: number): boolean {
  if (!sgData || sgData.length < 2) return false

  const sortedData = sortSgDataDesc(sgData)

  const currentSg = sortedData[0].value
  let stableFromDate = new Date(sortedData[0].date)

  for (let i = 1; i < sortedData.length; i++) {
    const reading = sortedData[i]
    if (reading.value > currentSg + threshold) {
      break
    }
    stableFromDate = new Date(reading.date)
  }

  const now = new Date()
  const stableHours = (now.getTime() - stableFromDate.getTime()) / (1000 * 60 * 60)
  const stableDaysActual = stableHours / 24

  console.log(`Gravity stability: current SG ${currentSg.toFixed(4)}, stable since ${stableFromDate.toISOString()}, ${stableDaysActual.toFixed(2)} days (need ${stableDays} days)`)

  return stableDaysActual >= stableDays
}

export function isSgConditionMet(sgData: SgDataPoint[], targetSg: number, comparison: string): boolean {
  const latest = getLatestSg(sgData)
  if (!latest) return false

  if (comparison === 'at_or_below') {
    return latest.value <= targetSg
  } else if (comparison === 'at_or_above') {
    return latest.value >= targetSg
  }

  return false
}

function calculateRampTemp(startTemp: number, endTemp: number, durationHours: number, elapsedHours: number): number {
  if (elapsedHours >= durationHours) return endTemp
  const progress = elapsedHours / durationHours
  return Math.round((startTemp + (endTemp - startTemp) * progress) * 10) / 10
}
// setProfileTarget is imported from ./types.ts (Single Source of Truth)


// ─── Step handlers ────────────────────────────────────────────────────

export async function processHoldStep(ctx: StepContext): Promise<StepResult> {
  const { currentStep, controller, brewData, steps, session, supabase, elapsedHours } = ctx
  let { stepCompleted, actionTaken, actionDetails } = defaultResult()

  // SAFETY: Warn if hold step has no exit condition
  if (!currentStep.duration_hours && currentStep.target_sg === null) {
    console.warn(`⚠️ Hold step ${session.current_step_index} in session ${session.id} has no exit condition (no duration, no SG target) — will never complete automatically`)
    actionDetails = { warning: 'no_exit_condition' }
  }

  if (currentStep.target_temp !== null) {
    const currentProfileTarget = controller?.profile_target_temp ? parseFloat(String(controller.profile_target_temp)) : null
    if (currentProfileTarget === null || Math.abs(currentProfileTarget - currentStep.target_temp) > 0.05) {
      await setProfileTarget(supabase, session.controller_id, currentStep.target_temp)
      actionTaken = 'profile_target_set'
      actionDetails = { profile_target: currentStep.target_temp, step_type: 'hold' }
    }
  }

  let durationComplete = false
  let sgTargetMet = false

  if (currentStep.duration_hours && elapsedHours >= currentStep.duration_hours) {
    durationComplete = true
  }

  if (brewData && currentStep.target_sg !== null && currentStep.sg_comparison) {
    sgTargetMet = isSgConditionMet(brewData.sg_data, currentStep.target_sg, currentStep.sg_comparison)
    if (sgTargetMet) {
      const latest = getLatestSg(brewData.sg_data)
      actionDetails = {
        ...actionDetails,
        condition: 'sg_reached',
        target_sg: currentStep.target_sg,
        current_sg: latest?.value,
        comparison: currentStep.sg_comparison
      }
      console.log(`Hold step: SG target met - current ${latest?.value} ${currentStep.sg_comparison} ${currentStep.target_sg}`)
    }
  }

  const holdEffectiveTarget = currentStep.target_temp ?? getEffectiveTargetTemp(steps, session.current_step_index)
  const holdCheckTemp = controller && holdEffectiveTarget
    ? getDirectionalTemp(controller, holdEffectiveTarget, controller.current_temp ?? holdEffectiveTarget)
    : (controller?.pill_temp ?? controller?.current_temp ?? null)
  const holdTempOk = !holdEffectiveTarget || !controller ||
    (holdCheckTemp !== null && Math.abs(holdCheckTemp - holdEffectiveTarget) <= 0.3)

  if (!holdTempOk) {
    console.log(`Hold step: condition met but temp not at target (current ${controller?.current_temp}°C, target ${holdEffectiveTarget}°C) - waiting`)
  }

  if (currentStep.duration_hours && currentStep.target_sg !== null) {
    stepCompleted = (durationComplete || sgTargetMet) && holdTempOk
  } else if (currentStep.duration_hours) {
    stepCompleted = durationComplete && holdTempOk
  } else if (currentStep.target_sg !== null) {
    stepCompleted = sgTargetMet && holdTempOk
  }

  if (stepCompleted && sgTargetMet) {
    actionTaken = 'condition_met'
  }

  return { stepCompleted, actionTaken, actionDetails }
}

export async function processRampStep(ctx: StepContext): Promise<StepResult> {
  const { currentStep, controller, session, supabase, elapsedHours } = ctx
  let { stepCompleted, actionTaken, actionDetails } = defaultResult()

  if (currentStep.target_temp === null) {
    return { stepCompleted, actionTaken, actionDetails }
  }

  if (currentStep.ramp_type === 'immediate') {
    await setProfileTarget(supabase, session.controller_id, currentStep.target_temp)

    const immStartTemp = session.step_start_temp ?? controller?.target_temp ?? currentStep.target_temp
    const immRampingUp = currentStep.target_temp > immStartTemp
    const immRampCheckTemp = immRampingUp
      ? (controller?.pill_temp ?? controller?.current_temp ?? null)
      : (controller?.current_temp ?? controller?.pill_temp ?? null)

    if (controller && immRampCheckTemp !== null &&
      Math.abs(immRampCheckTemp - currentStep.target_temp) <= 0.3) {
      stepCompleted = true
      actionTaken = 'temp_reached'
      actionDetails = { target_temp: currentStep.target_temp, current_temp: immRampCheckTemp }
      console.log(`Immediate ramp complete: temp ${immRampCheckTemp}°C reached target ${currentStep.target_temp}°C`)
    } else {
      actionTaken = 'profile_target_set'
      actionDetails = { profile_target: currentStep.target_temp, step_type: 'immediate_ramp' }
      console.log(`Immediate ramp: waiting for temp to reach ${currentStep.target_temp}°C (current: ${controller?.current_temp}°C)`)
    }
  } else {
    // Linear ramp
    if (controller && currentStep.duration_hours) {
      let startTemp: number = session.step_start_temp ?? controller.target_temp ?? currentStep.target_temp

      if (session.step_start_temp === null) {
        await supabase
          .from('fermentation_sessions')
          .update({ step_start_temp: startTemp })
          .eq('id', session.id)
        console.log(`Saved start temp ${startTemp}°C for ramp`)
      }

      const timeComplete = elapsedHours >= currentStep.duration_hours
      const rampingUp = currentStep.target_temp > startTemp
      const rampCheckTemp = rampingUp
        ? (controller.pill_temp ?? controller.current_temp)
        : (controller.current_temp ?? controller.pill_temp)
      const tempReached = rampCheckTemp !== null &&
        Math.abs(rampCheckTemp - currentStep.target_temp) <= 0.3

      console.log(`Ramp: ${startTemp}°C → ${currentStep.target_temp}°C over ${currentStep.duration_hours}h, elapsed: ${elapsedHours.toFixed(2)}h, rampingUp: ${rampingUp}, sensor: ${rampingUp ? 'pill' : 'probe'}, sensorTemp: ${rampCheckTemp}°C, tempReached: ${tempReached}`)

      if (tempReached) {
        await setProfileTarget(supabase, session.controller_id, currentStep.target_temp)
        actionTaken = 'temp_reached'
        actionDetails = { target_temp: currentStep.target_temp, current_temp: rampCheckTemp }

        if (timeComplete) {
          stepCompleted = true
          actionDetails = {
            ...actionDetails,
            time_complete: true,
            temp_reached: true,
          }
          console.log(`Ramp complete: time elapsed and temp reached ${currentStep.target_temp}°C`)
        }
      } else {
        const newTarget = calculateRampTemp(startTemp, currentStep.target_temp, currentStep.duration_hours, elapsedHours)
        const roundedTarget = Math.round(newTarget * 10) / 10

        const currentProfileTarget = controller.profile_target_temp ? parseFloat(String(controller.profile_target_temp)) : null
        if (currentProfileTarget === null || Math.abs(currentProfileTarget - roundedTarget) > 0.05) {
          await setProfileTarget(supabase, session.controller_id, roundedTarget)
          actionTaken = 'profile_target_set'
          actionDetails = {
            start_temp: startTemp,
            intermediate_target: roundedTarget,
            final_temp: currentStep.target_temp,
            progress: Math.min(1, elapsedHours / currentStep.duration_hours),
          }

          console.log(`📈 Ramp ${startTemp.toFixed(1)}→${currentStep.target_temp}°C: mellenmål=${roundedTarget.toFixed(1)}°C (${Math.round(Math.min(1, elapsedHours / currentStep.duration_hours) * 100)}%)`)
        }

        if (timeComplete) {
          console.log(`Ramp time complete but temp not reached: sensor=${rampCheckTemp}°C, target=${currentStep.target_temp}°C - waiting`)
        }
      }
    }
  }

  return { stepCompleted, actionTaken, actionDetails }
}

export async function processWaitForTempStep(ctx: StepContext): Promise<StepResult> {
  const { currentStep, controller, session, supabase } = ctx
  let { stepCompleted, actionTaken, actionDetails } = defaultResult()

  if (currentStep.target_temp !== null && controller) {
    await setProfileTarget(supabase, session.controller_id, currentStep.target_temp)

    const referenceTemp = controller.current_temp ?? currentStep.target_temp
    const waitCheckTemp = getDirectionalTemp(controller, currentStep.target_temp, referenceTemp)
    if (waitCheckTemp !== null && Math.abs(waitCheckTemp - currentStep.target_temp) <= 0.3) {
      stepCompleted = true
      actionTaken = 'temp_reached'
      actionDetails = { current_temp: waitCheckTemp, target_temp: currentStep.target_temp }
    } else {
      actionTaken = 'profile_target_set'
      actionDetails = { profile_target: currentStep.target_temp, step_type: 'wait_for_temp' }
    }
  }

  return { stepCompleted, actionTaken, actionDetails }
}

export async function processWaitForGravityStableStep(ctx: StepContext): Promise<StepResult> {
  const { currentStep, controller, brewData, steps, session, supabase, metrics } = ctx
  let { stepCompleted, actionTaken, actionDetails } = defaultResult()

  const effectiveTarget = getEffectiveTargetTemp(steps, session.current_step_index)
  if (effectiveTarget !== null) {
    await setProfileTarget(supabase, session.controller_id, effectiveTarget)
  }

  if (brewData && currentStep.gravity_stable_days && currentStep.gravity_threshold) {
    const stable = isGravityStable(
      brewData.sg_data,
      currentStep.gravity_stable_days,
      currentStep.gravity_threshold
    )
    const activityConfirms = !metrics || metrics.activity_score < 25
    if (stable && activityConfirms) {
      stepCompleted = true
      actionTaken = 'condition_met'
      actionDetails = { condition: 'gravity_stable', days: currentStep.gravity_stable_days, activity_score: metrics?.activity_score ?? null, fermentation_phase: metrics?.fermentation_phase ?? 'unknown' }
      console.log(`✅ Gravity stable: ${currentStep.gravity_stable_days}d, activity=${metrics?.activity_score ?? '?'}%, phase=${metrics?.fermentation_phase ?? '?'}`)
    } else if (stable && !activityConfirms) {
      console.log(`⚠️ Gravity stable but activity still ${metrics?.activity_score}% - waiting for confirmation`)
      actionDetails = { condition: 'gravity_stable_waiting_activity', activity_score: metrics?.activity_score, phase: metrics?.fermentation_phase }
    }
  }

  return { stepCompleted, actionTaken, actionDetails }
}

export async function processWaitForSgStep(ctx: StepContext): Promise<StepResult> {
  const { currentStep, brewData, steps, session, supabase } = ctx
  let { stepCompleted, actionTaken, actionDetails } = defaultResult()

  const effectiveTarget = getEffectiveTargetTemp(steps, session.current_step_index)
  if (effectiveTarget !== null) {
    await setProfileTarget(supabase, session.controller_id, effectiveTarget)
  }

  if (brewData && currentStep.target_sg !== null && currentStep.sg_comparison) {
    const met = isSgConditionMet(brewData.sg_data, currentStep.target_sg, currentStep.sg_comparison)
    if (met) {
      stepCompleted = true
      actionTaken = 'condition_met'
      const latest = getLatestSg(brewData.sg_data)
      actionDetails = {
        condition: 'sg_reached',
        target_sg: currentStep.target_sg,
        current_sg: latest?.value,
        comparison: currentStep.sg_comparison
      }
    }
  }

  return { stepCompleted, actionTaken, actionDetails }
}

export async function processWaitForAcknowledgementStep(ctx: StepContext): Promise<StepResult> {
  const { steps, session, supabase } = ctx

  const effectiveTarget = getEffectiveTargetTemp(steps, session.current_step_index)
  if (effectiveTarget !== null) {
    await setProfileTarget(supabase, session.controller_id, effectiveTarget)
  }

  return defaultResult()
}

export async function processDiacetylRestStep(ctx: StepContext): Promise<StepResult> {
  const { currentStep, controller, brewData, steps, session, supabase, metrics } = ctx
  let { stepCompleted, actionTaken, actionDetails } = defaultResult()

  const attenuationTrigger = currentStep.attenuation_trigger ?? 75
  const tempIncrease = currentStep.temp_increase ?? 3

  if (!brewData) {
    return { stepCompleted, actionTaken, actionDetails }
  }

  const latest = getLatestSg(brewData.sg_data)
  if (!latest) {
    console.log(`Diacetyl rest: No SG data available — waiting`)
    actionDetails = { phase: 'waiting_for_data', wait_reason: 'No SG readings available' }
    return { stepCompleted, actionTaken, actionDetails }
  }

  const latestSg = latest.value
  const og = brewData.original_gravity
  const fg = brewData.final_gravity
  const attRange = og - fg

  // SAFETY: Guard against inverted/zero gravity range
  if (attRange <= 0.001) {
    console.error(`🚨 Diacetyl rest: Invalid gravity range OG=${og} FG=${fg} (attRange=${attRange.toFixed(4)}) — cannot calculate attenuation`)
    actionDetails = { phase: 'error', wait_reason: `Invalid gravity range: OG=${og}, FG=${fg}` }
    return { stepCompleted, actionTaken, actionDetails }
  }

  const currentAtt = ((og - latestSg) / attRange) * 100

  const phaseReady = !metrics || metrics.fermentation_phase === 'declining' || metrics.fermentation_phase === 'stationary'
  const attenuationReady = currentAtt >= attenuationTrigger

  // Check if already triggered (ramp_triggered_at used as state flag)
  const alreadyTriggered = session.ramp_triggered_at !== null

  if (!alreadyTriggered && (!attenuationReady || !phaseReady)) {
    const effectiveTarget = getEffectiveTargetTemp(steps, session.current_step_index)
    if (effectiveTarget !== null) {
      await setProfileTarget(supabase, session.controller_id, effectiveTarget)
    }
    const waitReason = !attenuationReady
      ? `attenuation ${Math.round(currentAtt)}% < ${attenuationTrigger}%`
      : `phase=${metrics?.fermentation_phase ?? 'unknown'} (need declining/stationary)`
    actionDetails = {
      phase: 'waiting_for_trigger',
      current_attenuation: Math.round(currentAtt),
      trigger: attenuationTrigger,
      fermentation_phase: metrics?.fermentation_phase ?? 'unknown',
      activity_score: metrics?.activity_score ?? null,
      wait_reason: waitReason,
    }
    console.log(`Diacetyl rest: waiting - ${waitReason}`)
    return { stepCompleted, actionTaken, actionDetails }
  }

  // First trigger — record state and notify
  if (!alreadyTriggered) {
    console.log(`🍺 Diacetyl rest triggered: att=${Math.round(currentAtt)}%, phase=${metrics?.fermentation_phase ?? 'unknown'}, activity=${metrics?.activity_score ?? '?'}%`)

    await supabase
      .from('fermentation_sessions')
      .update({ ramp_triggered_at: new Date().toISOString() })
      .eq('id', session.id)

    await insertNotification(supabase, {
      type: 'diacetyl_rest_triggered',
      title: 'Diacetylvila startad',
      body: `Attenuation nått ${Math.round(currentAtt)}% — temperaturen höjs med ${tempIncrease}°C`,
      controller_id: session.controller_id,
      brew_id: session.brew_id,
    })
  }

  const effectiveTarget = getEffectiveTargetTemp(steps, session.current_step_index)
  const diacetylTarget = (effectiveTarget ?? 18) + tempIncrease

  await setProfileTarget(supabase, session.controller_id, diacetylTarget)
  actionTaken = 'profile_target_set'
  actionDetails = { profile_target: diacetylTarget, phase: 'diacetyl_active', temp_increase: tempIncrease, fermentation_phase: metrics?.fermentation_phase ?? 'unknown' }

  const stableDays = currentStep.gravity_stable_days ?? 2
  const threshold = currentStep.gravity_threshold ?? 0.001
  const sgStable = isGravityStable(brewData.sg_data, stableDays, threshold)
  const activityLow = !metrics || metrics.activity_score < 20

  if (sgStable && activityLow) {
    stepCompleted = true
    actionTaken = 'condition_met'
    actionDetails = { ...actionDetails, condition: 'diacetyl_rest_complete', stable_days: stableDays, activity_score: metrics?.activity_score ?? null }
    console.log(`✅ Diacetyl rest complete: SG stable ${stableDays}d, activity=${metrics?.activity_score ?? '?'}%`)

    await insertNotification(supabase, {
      type: 'diacetyl_rest_completed',
      title: 'Diacetylvila klar',
      body: `SG stabil i ${stableDays} dagar och aktivitet ${Math.round(metrics?.activity_score ?? 0)}% — redo för nästa steg`,
      controller_id: session.controller_id,
      brew_id: session.brew_id,
    })
  } else if (sgStable && !activityLow) {
    console.log(`Diacetyl rest: SG stable but activity still high (${metrics?.activity_score}%) - waiting`)
    actionDetails = { ...actionDetails, phase: 'diacetyl_active_waiting', sg_stable: true, activity_score: metrics?.activity_score }
  }

  return { stepCompleted, actionTaken, actionDetails }
}

export async function processGradualRampStep(ctx: StepContext): Promise<StepResult> {
  const { currentStep, controller, brewData, steps, session, supabase, metrics } = ctx
  let { stepCompleted, actionTaken, actionDetails } = defaultResult()

  const activityTrigger = currentStep.activity_trigger ?? 35
  if (activityTrigger <= 0) {
    console.error(`🚨 Gradual ramp: activityTrigger is ${activityTrigger} — must be > 0. Defaulting to 35.`)
  }
  const safeActivityTrigger = activityTrigger > 0 ? activityTrigger : 35
  const tempIncrease = currentStep.temp_increase ?? 3
  const minRampHours = currentStep.min_ramp_hours ?? null
  const activityScore = metrics?.activity_score ?? 100

  if (!brewData) {
    return { stepCompleted, actionTaken, actionDetails }
  }

  const effectiveTarget = getEffectiveTargetTemp(steps, session.current_step_index)
  const baseTemp = effectiveTarget ?? 18
  const currentProfileTarget = controller?.profile_target_temp ? parseFloat(String(controller.profile_target_temp)) : null
  const backendAlreadyRamping = currentProfileTarget !== null && currentProfileTarget > baseTemp + 0.05

  const triggered = backendAlreadyRamping || activityScore <= safeActivityTrigger

  if (!triggered) {
    if (effectiveTarget !== null) {
      await setProfileTarget(supabase, session.controller_id, effectiveTarget)
    }
    actionDetails = {
      phase: 'waiting_for_trigger',
      activity_score: activityScore,
      activity_trigger: activityTrigger,
      fermentation_phase: metrics?.fermentation_phase ?? 'unknown',
      wait_reason: `activity ${Math.round(activityScore)}% > ${activityTrigger}%`,
    }
    console.log(`Gradual ramp: waiting - activity ${Math.round(activityScore)}% > ${activityTrigger}%`)
    return { stepCompleted, actionTaken, actionDetails }
  }

  // Record when the ramp was first triggered
  let rampTriggeredAt: Date
  if (session.ramp_triggered_at) {
    rampTriggeredAt = new Date(session.ramp_triggered_at)
  } else {
    // First trigger — save ramp_triggered_at and step_start_temp
    rampTriggeredAt = new Date()
    await supabase
      .from('fermentation_sessions')
      .update({
        ramp_triggered_at: rampTriggeredAt.toISOString(),
        step_start_temp: baseTemp,
      })
      .eq('id', session.id)

    await supabase.from('fermentation_step_log').insert({
      session_id: session.id,
      step_index: session.current_step_index,
      action: 'condition_met',
      details: {
        condition: 'gradual_ramp_triggered',
        activity_score: activityScore,
        activity_trigger: activityTrigger,
        base_temp: baseTemp,
        temp_increase: tempIncrease,
        min_ramp_hours: minRampHours,
      },
    })
    console.log(`🎯 Gradual ramp triggered! activity=${Math.round(activityScore)}% <= ${activityTrigger}%, base=${baseTemp}°C, +${tempIncrease}°C`)

    // Notify user that the smart diacetyl rest has started
    await insertNotification(supabase, {
      type: 'gradual_ramp_triggered',
      title: 'Smart diacetylvila startad',
      body: `Aktivitet sjunkit till ${Math.round(activityScore)}% — temperaturhöjning påbörjas från ${baseTemp}°C (+${tempIncrease}°C)`,
      controller_id: session.controller_id,
      brew_id: session.brew_id,
    })
  }

  // Phase 2: Ramping (always exponential curve for gentler start)
  let rampProgress = Math.min(1, Math.max(0, (safeActivityTrigger - activityScore) / safeActivityTrigger))
  rampProgress = rampProgress ** 2
  let calculatedTarget = Math.round((baseTemp + tempIncrease * rampProgress) * 10) / 10

  // Apply min ramp hours constraint using ramp_triggered_at (not step_started_at)
  // Skip time constraint when activity is 0% — fermentation is done, no reason to wait
  if (minRampHours && minRampHours > 0 && activityScore > 0) {
    const now = new Date()
    const elapsedSinceTrigger = (now.getTime() - rampTriggeredAt.getTime()) / (1000 * 60 * 60)
    const maxAllowedIncrease = (tempIncrease / minRampHours) * elapsedSinceTrigger
    const timeConstrainedTarget = Math.round((baseTemp + Math.min(tempIncrease, maxAllowedIncrease)) * 10) / 10
    if (calculatedTarget > timeConstrainedTarget) {
      console.log(`⏱️ Min ramp constraint: activity wants ${calculatedTarget}°C but time allows max ${timeConstrainedTarget}°C (${elapsedSinceTrigger.toFixed(1)}h / ${minRampHours}h since trigger)`)
      calculatedTarget = timeConstrainedTarget
    }
  } else if (minRampHours && activityScore === 0) {
    console.log(`⏱️ Min ramp constraint skipped: activity=0% (fermentation done), allowing full target ${calculatedTarget}°C`)
  }

  const maxTarget = Math.round((baseTemp + tempIncrease) * 10) / 10
  const cappedCurrentTarget = (currentProfileTarget !== null && currentProfileTarget > baseTemp)
    ? Math.min(currentProfileTarget, maxTarget)
    : null
  const rampedTarget = cappedCurrentTarget !== null
    ? Math.max(calculatedTarget, cappedCurrentTarget)
    : calculatedTarget

  if (currentProfileTarget === null || Math.abs(currentProfileTarget - rampedTarget) > 0.05) {
    await setProfileTarget(supabase, session.controller_id, rampedTarget)
    actionTaken = 'temp_adjusted'
    actionDetails = {
      phase: 'gradual_ramping',
      base_temp: baseTemp,
      ramped_target: rampedTarget,
      max_target: baseTemp + tempIncrease,
      activity_score: activityScore,
      activity_trigger: activityTrigger,
      ramp_progress: tempIncrease > 0 ? Math.round(((rampedTarget - baseTemp) / tempIncrease) * 100) : 0,
      fermentation_phase: metrics?.fermentation_phase ?? 'unknown',
    }
    console.log(`🔄 Gradual ramp: activity=${Math.round(activityScore)}%, progress=${Math.round(rampProgress * 100)}%, target=${rampedTarget}°C (base=${baseTemp}, +${tempIncrease}°C max)`)
  }

  // Phase 3: Check completion
  const stableDays = currentStep.gravity_stable_days ?? 2
  const threshold = currentStep.gravity_threshold ?? 0.001
  const sgStable = isGravityStable(brewData.sg_data, stableDays, threshold)
  const activityLow = !metrics || metrics.activity_score < 15

  if (sgStable && activityLow) {
    stepCompleted = true
    actionTaken = 'condition_met'
    actionDetails = {
      condition: 'gradual_ramp_complete',
      stable_days: stableDays,
      activity_score: metrics?.activity_score ?? null,
      final_target: rampedTarget,
    }
    console.log(`✅ Gradual ramp complete: SG stable ${stableDays}d, activity=${metrics?.activity_score ?? '?'}%`)

    // Notify user that the smart diacetyl rest is complete
    await insertNotification(supabase, {
      type: 'gradual_ramp_completed',
      title: 'Smart diacetylvila klar',
      body: `SG stabil i ${stableDays} dagar och aktivitet ${Math.round(metrics?.activity_score ?? 0)}% — redo för nästa steg`,
      controller_id: session.controller_id,
      brew_id: session.brew_id,
    })
  } else if (sgStable && !activityLow) {
    console.log(`Gradual ramp: SG stable but activity still ${metrics?.activity_score}% (need <15) - continuing`)
    actionDetails = { ...actionDetails, phase: 'gradual_ramping_waiting', sg_stable: true, activity_score: metrics?.activity_score }
  }

  return { stepCompleted, actionTaken, actionDetails }
}

// ─── Dispatcher ───────────────────────────────────────────────────────

export async function processStep(ctx: StepContext): Promise<StepResult> {
  switch (ctx.currentStep.step_type) {
    case 'hold':
      return processHoldStep(ctx)
    case 'ramp':
      return processRampStep(ctx)
    case 'wait_for_temp':
      return processWaitForTempStep(ctx)
    case 'wait_for_gravity_stable':
      return processWaitForGravityStableStep(ctx)
    case 'wait_for_sg':
      return processWaitForSgStep(ctx)
    case 'wait_for_acknowledgement':
      return processWaitForAcknowledgementStep(ctx)
    case 'diacetyl_rest':
      return processDiacetylRestStep(ctx)
    case 'gradual_ramp':
      return processGradualRampStep(ctx)
    default:
      console.error(`🚨 Unknown step_type "${ctx.currentStep.step_type}" in session ${ctx.session.id}, step ${ctx.session.current_step_index} — skipping step for safety`)
      await insertNotification(ctx.supabase, {
        type: 'unknown_step_type',
        title: 'Okänd stegtyp i profil',
        body: `Steg ${ctx.session.current_step_index} har okänd typ "${ctx.currentStep.step_type}" — sessionen kan inte fortsätta automatiskt`,
        controller_id: ctx.session.controller_id,
        brew_id: ctx.session.brew_id,
      })
      return { stepCompleted: false, actionTaken: 'unknown_step_type', actionDetails: { step_type: ctx.currentStep.step_type } }
  }
}
