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

  // Use 6 decimal precision for parameters like SG residuals (≤0.0003),
  // but keep 2 decimals for larger values like temperatures/margins.
  const precision = Math.abs(newValue) < 0.01 ? 1e6 : 100
  const rounded = Math.round(newValue * precision) / precision

  await supabase.from('fermentation_learnings').upsert({
    controller_id: controllerId,
    parameter_name: paramName,
    learned_value: rounded,
    sample_count: sampleCount + 1,
    last_updated_at: new Date().toISOString(),
  }, { onConflict: 'controller_id,parameter_name' })

  return { oldValue: currentValue, newValue, sampleCount: sampleCount + 1 }
}

/**
 * Batched learning: pre-reads all candidate params, computes EMA in memory,
 * flushes all updates as a single upsert. Saves N reads + N writes → 1 read + 1 write.
 */
export class LearnBatch {
  private supabase: ReturnType<typeof createClient>
  private controllerId: string
  private cache = new Map<string, { value: number; sampleCount: number }>()
  private updates: Array<{ paramName: string; rounded: number; sampleCount: number }> = []
  private loaded = false

  constructor(supabase: ReturnType<typeof createClient>, controllerId: string) {
    this.supabase = supabase
    this.controllerId = controllerId
  }

  /** Pre-load all candidate params in a single query */
  async preload(paramNames: string[]): Promise<void> {
    const { data } = await this.supabase
      .from('fermentation_learnings')
      .select('parameter_name, learned_value, sample_count')
      .eq('controller_id', this.controllerId)
      .in('parameter_name', paramNames)

    for (const row of data ?? []) {
      this.cache.set(row.parameter_name, {
        value: parseFloat(String(row.learned_value)),
        sampleCount: row.sample_count ?? 0,
      })
    }
    this.loaded = true
  }

  /** Read a cached param without modifying it */
  getCached(paramName: string): { value: number; sampleCount: number } | undefined {
    return this.cache.get(paramName)
  }

  /** Compute EMA update in memory (no DB call) */
  update(
    paramName: string,
    newObservation: number,
    clampMin: number,
    clampMax: number,
    alphaOverride?: number,
  ): { oldValue: number; newValue: number; sampleCount: number } {
    const existing = this.cache.get(paramName)
    const sampleCount = existing?.sampleCount ?? 0
    const alpha = alphaOverride ?? (sampleCount < 5 ? 0.5 : 0.2)
    const currentValue = existing ? existing.value : newObservation
    const newValue = Math.max(clampMin, Math.min(clampMax, currentValue * (1 - alpha) + newObservation * alpha))

    const precision = Math.abs(newValue) < 0.01 ? 1e6 : 100
    const rounded = Math.round(newValue * precision) / precision

    // Update cache so subsequent reads in the same batch see the new value
    this.cache.set(paramName, { value: rounded, sampleCount: sampleCount + 1 })
    this.updates.push({ paramName, rounded, sampleCount: sampleCount + 1 })

    return { oldValue: currentValue, newValue, sampleCount: sampleCount + 1 }
  }

  /** Flush all accumulated updates as a single upsert */
  async flush(): Promise<void> {
    if (this.updates.length === 0) return
    const now = new Date().toISOString()
    const rows = this.updates.map(u => ({
      controller_id: this.controllerId,
      parameter_name: u.paramName,
      learned_value: u.rounded,
      sample_count: u.sampleCount,
      last_updated_at: now,
    }))
    await this.supabase.from('fermentation_learnings').upsert(rows, { onConflict: 'controller_id,parameter_name' })
    this.updates = []
  }
}

/** Batch-read multiple learned parameters in a single query.
 *  controllerId can be a single string or an array of controller IDs.
 *  When multiple controllers are provided, returned keys are prefixed: `{controllerId}:{paramName}` */
export async function getLearnedParams(
  supabase: ReturnType<typeof createClient>,
  controllerId: string | string[],
  paramNames: string[],
  defaults: Record<string, number>,
): Promise<Map<string, { value: number; sampleCount: number }>> {
  const isMulti = Array.isArray(controllerId)
  const controllerIds = isMulti ? controllerId : [controllerId]

  let query = supabase
    .from('fermentation_learnings')
    .select('controller_id, parameter_name, learned_value, sample_count')
    .in('parameter_name', paramNames)

  if (controllerIds.length === 1) {
    query = query.eq('controller_id', controllerIds[0])
  } else {
    query = query.in('controller_id', controllerIds)
  }

  const { data } = await query

  const result = new Map<string, { value: number; sampleCount: number }>()

  if (isMulti) {
    // Multi-controller: key = `controllerId:paramName`
    const dataMap = new Map((data ?? []).map(r => [`${r.controller_id}:${r.parameter_name}`, r]))
    for (const cId of controllerIds) {
      for (const name of paramNames) {
        const row = dataMap.get(`${cId}:${name}`)
        result.set(`${cId}:${name}`, {
          value: row ? parseFloat(String(row.learned_value)) : (defaults[name] ?? 0),
          sampleCount: row?.sample_count ?? 0,
        })
      }
    }
  } else {
    // Single controller: key = paramName (backward-compatible)
    const dataMap = new Map((data ?? []).map(r => [r.parameter_name, r]))
    for (const name of paramNames) {
      const row = dataMap.get(name)
      result.set(name, {
        value: row ? parseFloat(String(row.learned_value)) : (defaults[name] ?? 0),
        sampleCount: row?.sample_count ?? 0,
      })
    }
  }
  return result
}
