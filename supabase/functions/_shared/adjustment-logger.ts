import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ============================================================
// Single Source of Truth: auto_cooling_adjustments insert helper
// Eliminates 8+ duplicated insert patterns across auto-adjust-cooling.
// ============================================================

export interface AdjustmentRecord {
  cooler_controller_id: string
  cooler_controller_name: string
  old_target_temp: number
  new_target_temp: number
  lowest_followed_temp: number
  reason: string
  // Optional fields
  original_target_temp?: number | null
  followed_controller_id?: string | null
  followed_controller_name?: string | null
  followed_current_temp?: number | null
  followed_target_temp?: number | null
  followed_hysteresis?: number | null
  adjusted_against_timestamp?: string | null
}

/** Insert an adjustment record into auto_cooling_adjustments */
export async function logAdjustment(
  supabase: ReturnType<typeof createClient>,
  record: AdjustmentRecord
): Promise<void> {
  await supabase.from('auto_cooling_adjustments').insert({
    cooler_controller_id: record.cooler_controller_id,
    cooler_controller_name: record.cooler_controller_name,
    old_target_temp: record.old_target_temp,
    new_target_temp: record.new_target_temp,
    lowest_followed_temp: record.lowest_followed_temp,
    original_target_temp: record.original_target_temp ?? null,
    followed_controller_id: record.followed_controller_id ?? null,
    followed_controller_name: record.followed_controller_name ?? null,
    followed_current_temp: record.followed_current_temp ?? null,
    followed_target_temp: record.followed_target_temp ?? null,
    followed_hysteresis: record.followed_hysteresis ?? null,
    adjusted_against_timestamp: record.adjusted_against_timestamp ?? null,
    reason: record.reason,
  } as any)
}

/** Tracked adjustment result for the orchestrator's allAdjustments array */
export interface AdjustmentResult {
  cooler: string
  oldTarget: number
  newTarget: number
}
