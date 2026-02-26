/**
 * Single source of truth for calculating the current interpolated profile target.
 * Used by TempStat, FermentationSessionCompact, and any other component that
 * needs the "live Mål" value during a fermentation session.
 */

interface FermentationStep {
  step_type: string;
  target_temp: number | null;
  duration_hours: number | null;
}

interface SessionInfo {
  current_step_index: number;
  step_started_at: string;
  step_start_temp: number | null;
  steps: FermentationStep[];
  controller_profile_target_temp?: number | null;
}

/**
 * Calculate the current interpolated profile target temperature.
 * During ramps, linearly interpolates between step_start_temp and step target.
 * For hold/wait steps, returns the step's target_temp or falls back to previous steps.
 */
export function getInterpolatedProfileTarget(session: SessionInfo | null | undefined): number | null {
  if (!session?.steps?.length) return null;

  const stepIdx = session.current_step_index;
  const step = session.steps[stepIdx];
  if (!step) return null;

  const stepTarget = step.target_temp;

  // For backend-driven steps (gradual_ramp, diacetyl_rest), the target is dynamically
  // calculated by the edge function and stored in controller's profile_target_temp.
  // Use that value directly when available.
  if ((step.step_type === 'gradual_ramp' || step.step_type === 'diacetyl_rest') && session.controller_profile_target_temp != null) {
    return session.controller_profile_target_temp;
  }

  // During a ramp with duration, interpolate between start temp and target
  if (step.step_type === 'ramp' && step.duration_hours && session.step_start_temp != null && stepTarget != null) {
    const elapsed = (Date.now() - new Date(session.step_started_at).getTime()) / (1000 * 60 * 60);
    const progress = Math.min(elapsed / step.duration_hours, 1);
    return Math.round((session.step_start_temp + (stepTarget - session.step_start_temp) * progress) * 10) / 10;
  }

  if (stepTarget != null) return stepTarget;

  // Current step has no target_temp (e.g. wait steps) — look back through previous steps
  for (let i = stepIdx - 1; i >= 0; i--) {
    if (session.steps[i]?.target_temp != null) {
      return session.steps[i].target_temp;
    }
  }

  return null;
}
