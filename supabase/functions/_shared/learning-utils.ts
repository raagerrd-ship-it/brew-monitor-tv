import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ============================================================
// Shared learning utilities (Single Source of Truth)
// EMA-based parameter learning for fermentation_learnings table.
// ============================================================

/** Temperature bucket for context-aware learning */
export function getTempBucket(targetTemp: number): string {
  if (targetTemp < 8) return 'cold'      // Cold crash / lagering
  if (targetTemp < 14) return 'cool'     // Lager fermentation
  if (targetTemp < 20) return 'warm'     // Ale fermentation
  return 'hot'                           // Saison / high-temp
}

/** Load a learned parameter, returning the learned value or a default */
export async function getLearnedParam(
  supabase: ReturnType<typeof createClient>,
  controllerId: string,
  paramName: string,
  defaultValue: number
): Promise<{ value: number; sampleCount: number }> {
  const { data } = await supabase
    .from('fermentation_learnings')
    .select('learned_value, sample_count')
    .eq('controller_id', controllerId)
    .eq('parameter_name', paramName)
    .maybeSingle()
  return {
    value: data ? parseFloat(String(data.learned_value)) : defaultValue,
    sampleCount: data?.sample_count ?? 0,
  }
}

/** Update a learned parameter with EMA (exponential moving average) */
export async function updateLearnedParam(
  supabase: ReturnType<typeof createClient>,
  controllerId: string,
  paramName: string,
  newObservation: number,
  clampMin: number,
  clampMax: number,
  alphaOverride?: number
): Promise<{ oldValue: number; newValue: number; sampleCount: number }> {
  const { data: existing } = await supabase
    .from('fermentation_learnings')
    .select('learned_value, sample_count')
    .eq('controller_id', controllerId)
    .eq('parameter_name', paramName)
    .maybeSingle()

  const sampleCount = existing?.sample_count ?? 0
  const alpha = alphaOverride ?? (sampleCount < 5 ? 0.5 : 0.2) // Learn faster initially
  const currentValue = existing ? parseFloat(String(existing.learned_value)) : newObservation
  const newValue = Math.max(clampMin, Math.min(clampMax, currentValue * (1 - alpha) + newObservation * alpha))

  await supabase.from('fermentation_learnings').upsert({
    controller_id: controllerId,
    parameter_name: paramName,
    learned_value: Math.round(newValue * 100) / 100,
    sample_count: sampleCount + 1,
    last_updated_at: new Date().toISOString(),
  }, { onConflict: 'controller_id,parameter_name' })

  return { oldValue: currentValue, newValue, sampleCount: sampleCount + 1 }
}
