import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ProfileStep, TempController } from './temp-utils.ts'

// ============================================================
// Single Source of Truth: Shared domain types
// All fermentation-related types live here.
// ============================================================

// Re-export core types from their canonical locations
export type { ProfileStep, TempController } from './temp-utils.ts'

// ─── Data types ───────────────────────────────────────────────────────

/** A single SG measurement point from brew_readings.sg_data */
export interface SgDataPoint {
  date: string
  value: number
  temp: number
}

/** Brew data relevant to fermentation step processing */
export interface BrewData {
  sg_data: SgDataPoint[]
  original_gravity: number
  final_gravity: number
}

/** Pre-computed fermentation metrics from brew_fermentation_metrics */
export interface FermentationMetrics {
  fermentation_phase: string
  activity_score: number
  sg_rate_per_hour: number
  eta_to_fg_hours: number | null
  ready_to_crash: boolean
}

// ─── Session types ────────────────────────────────────────────────────

/** Full fermentation session row (matches fermentation_sessions table) */
export interface FermentationSession {
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

/** Minimal session reference for lifecycle operations */
export interface SessionRef {
  id: string
  controller_id: string
  brew_id: string | null
  started_at: string
}

// ─── Step processing types ────────────────────────────────────────────

/** Context passed to each step handler */
export interface StepContext {
  supabase: ReturnType<typeof createClient>
  session: FermentationSession
  currentStep: ProfileStep
  steps: ProfileStep[]
  controller: TempController | null
  brewData: BrewData | null
  metrics: FermentationMetrics | null
  elapsedHours: number
}

/** Result from processing a step */
export interface StepResult {
  stepCompleted: boolean
  actionTaken: string
  actionDetails: any
}

// ─── Shared DB write helper ───────────────────────────────────────────

/**
 * Set profile_target_temp on a controller.
 * This is the SINGLE place that writes profile_target_temp.
 * Used by step-handlers (during step processing) and session-lifecycle (during step transitions).
 */
export async function setProfileTarget(
  supabase: ReturnType<typeof createClient>,
  controllerId: string,
  profileTarget: number,
): Promise<void> {
  await supabase
    .from('rapt_temp_controllers')
    .update({ profile_target_temp: profileTarget, updated_at: new Date().toISOString() })
    .eq('controller_id', controllerId)
  console.log(`📋 Profile target set: ${profileTarget}°C for ${controllerId} (PID will enforce)`)
}

/**
 * Clear profile_target_temp on a controller (e.g. when a profile completes).
 * Companion to setProfileTarget — ensures all profile_target_temp writes go through types.ts.
 */
export async function clearProfileTarget(
  supabase: ReturnType<typeof createClient>,
  controllerId: string,
): Promise<void> {
  await supabase
    .from('rapt_temp_controllers')
    .update({ profile_target_temp: null, updated_at: new Date().toISOString() })
    .eq('controller_id', controllerId)
  console.log(`📋 Profile target cleared for ${controllerId}`)
}
