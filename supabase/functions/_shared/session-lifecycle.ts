import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ProfileStep, getEffectiveTargetTemp } from './temp-utils.ts'
import { insertNotification } from './notifications.ts'
import { saveFermentationLearnings } from './fermentation-learnings.ts'
import { SessionRef, setProfileTarget, clearProfileTarget } from './types.ts'

/**
 * Complete a fermentation profile session.
 * Handles: session status update, clear profile target, step log, notification, and learning.
 */
export async function completeProfile(
  supabase: ReturnType<typeof createClient>,
  session: SessionRef,
  stepIndex: number,
): Promise<void> {
  // Mark session as completed
  await supabase
    .from('fermentation_sessions')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', session.id)

  // Log completion
  await supabase.from('fermentation_step_log').insert({
    session_id: session.id,
    step_index: stepIndex,
    action: 'completed',
    details: { message: 'Profile completed' },
  })

  // Clear profile_target_temp (via shared helper — SSOT)
  await clearProfileTarget(supabase, session.controller_id)

  // Notification
  await insertNotification(supabase, {
    type: 'profile_completed',
    title: 'Fermenteringsprofil klar',
    body: `Controller ${session.controller_id} har slutfört sin profil`,
    controller_id: session.controller_id,
    brew_id: session.brew_id,
  })

  // Learning
  await saveFermentationLearnings(supabase, session.controller_id, session.started_at)
}

/**
 * Advance to the next step in a fermentation session.
 * Sets profile target for the new step immediately.
 */
export async function advanceToNextStep(
  supabase: ReturnType<typeof createClient>,
  sessionId: string,
  controllerId: string,
  nextStepIndex: number,
  steps: ProfileStep[],
  previousStepType: string,
): Promise<void> {
  // Update session to next step
  await supabase
    .from('fermentation_sessions')
    .update({
      current_step_index: nextStepIndex,
      step_started_at: new Date().toISOString(),
      step_start_temp: null,
      ramp_triggered_at: null,
    })
    .eq('id', sessionId)

  // Set profile_target_temp for the new step (via shared helper — SSOT)
  const nextStep = steps[nextStepIndex]
  if (nextStep) {
    const target = nextStep.target_temp ?? getEffectiveTargetTemp(steps, nextStepIndex)
    if (target !== null) {
      await setProfileTarget(supabase, controllerId, target)
      const source = nextStep.target_temp !== null ? 'explicit' : 'inherited'
      console.log(`🎯 Step transition: ${source} target=${target}°C for step ${nextStepIndex} (${nextStep.step_type})`)
    }
  }

  // Log step start
  await supabase.from('fermentation_step_log').insert({
    session_id: sessionId,
    step_index: nextStepIndex,
    action: 'started',
    details: {
      previous_step: previousStepType,
      new_step: nextStep?.step_type || 'unknown',
    },
  })
}
