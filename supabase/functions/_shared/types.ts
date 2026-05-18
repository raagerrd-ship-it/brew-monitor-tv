import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ProfileStep, TempController } from './temp-utils.ts'

// ============================================================
// Single Source of Truth: Shared domain types
// All fermentation-related types live here.
// ============================================================

// Re-export core types from their canonical locations
export type { ProfileStep, TempController } from './temp-utils.ts'

// ─── Data types ───────────────────────────────────────────────────────

/** A single SG measurement point — used by both legacy sg_data and snapshots */
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

// ─── Snapshot → SgDataPoint helper ────────────────────────────────────

/**
 * Fetch SG data from brew_data_snapshots for a given brew.
 * Returns data in the same SgDataPoint format as the legacy sg_data field.
 * Snapshots are the SSOT — this replaces reading from brew_readings.sg_data.
 */
export async function fetchSgDataFromSnapshots(
  supabase: any,
  brewId: string,
): Promise<SgDataPoint[]> {
  const allRows: { recorded_at: string; sg: number | null; pill_temp: number | null }[] = []
  let offset = 0
  const batchSize = 1000
  let hasMore = true
  while (hasMore) {
    const { data } = await supabase
      .from('brew_data_snapshots')
      .select('recorded_at, sg, pill_temp')
      .eq('brew_id', brewId)
      .order('recorded_at', { ascending: true })
      .range(offset, offset + batchSize - 1)
    if (!data || data.length === 0) { hasMore = false }
    else {
      allRows.push(...data)
      offset += batchSize
      hasMore = data.length === batchSize
    }
  }
  return allRows
    .filter(r => r.sg != null)
    .map(r => ({
      date: r.recorded_at,
      value: r.sg!,
      temp: r.pill_temp ?? 0,
    }))
}

/**
 * Batch-fetch SG data from snapshots for multiple brew IDs.
 * Returns a Map<brewId, SgDataPoint[]>.
 */
export async function fetchSgDataBatch(
  supabase: any,
  brewIds: string[],
): Promise<Map<string, SgDataPoint[]>> {
  const result = new Map<string, SgDataPoint[]>()
  if (brewIds.length === 0) return result

  // Fetch all snapshots for all brews in one query (thinning caps at ~500 per brew)
  const allRows: { brew_id: string; recorded_at: string; sg: number | null; pill_temp: number | null }[] = []
  let offset = 0
  const batchSize = 1000
  let hasMore = true
  while (hasMore) {
    const { data } = await supabase
      .from('brew_data_snapshots')
      .select('brew_id, recorded_at, sg, pill_temp')
      .in('brew_id', brewIds)
      .order('recorded_at', { ascending: true })
      .range(offset, offset + batchSize - 1)
    if (!data || data.length === 0) { hasMore = false }
    else {
      allRows.push(...data)
      offset += batchSize
      hasMore = data.length === batchSize
    }
  }

  for (const row of allRows) {
    if (row.sg == null) continue
    const list = result.get(row.brew_id) || []
    list.push({ date: row.recorded_at, value: row.sg, temp: row.pill_temp ?? 0 })
    result.set(row.brew_id, list)
  }
  return result
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
  ramp_start_sg: number | null
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
  supabase: any
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
  supabase: any,
  controllerId: string,
  profileTarget: number,
): Promise<void> {
  await supabase
    .from('rapt_temp_controllers')
    .update({ profile_target_temp: profileTarget, updated_at: new Date().toISOString() })
    .eq('controller_id', controllerId)
  console.log(`📋 Profile target set: ${profileTarget}°C for ${controllerId} (PID will enforce)`)
}

