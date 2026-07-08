// ============================================================
// Shared learning utilities (Single Source of Truth)
// EMA-based parameter learning for fermentation_learnings table.
// ============================================================

/** Shape of a row in fermentation_learnings — used to give the batch/multi-
 *  controller read paths real types instead of falling through to implicit
 *  `any` (which TypeScript strict mode doesn't always catch automatically
 *  when the source is `(possiblyAny ?? []).map(...)` — a known inference
 *  gap, not something specific to this file, but worth typing around). */
interface LearnedRow {
  controller_id: string
  parameter_name: string
  learned_value: number | string
  sample_count: number
}

/** Temperature bucket for context-aware learning */
export function getTempBucket(targetTemp: number): string {
  if (targetTemp < 8) return 'cold'      // Cold crash / lagering
  if (targetTemp < 14) return 'cool'     // Lager fermentation
  if (targetTemp < 20) return 'warm'     // Ale fermentation
  return 'hot'                           // Saison / high-temp
}

/** Load a learned parameter, returning the learned value or a default */
export async function getLearnedParam(
  supabase: any,
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

/** Blend a new observation into an existing EMA value, with an optional
 *  hard cap on how far a single observation can move it. Pure function —
 *  no DB access — shared by updateLearnedParam and LearnBatch.update so the
 *  two can't drift out of sync with each other.
 *
 *  maxStepFraction is opt-in and OFF by default (undefined): existing
 *  callers that don't pass it get byte-identical behavior to before. When
 *  set, it caps |newValue − currentValue| to that fraction of the
 *  (clampMin, clampMax) range in a single call — e.g. 0.15 means one
 *  observation can move the stored value by at most 15% of its full range,
 *  regardless of how far the raw observation itself was off. This guards
 *  against a single anomalous measurement window (e.g. a glycol-saturation
 *  afternoon skewing a 6h thermal-response sample) cementing itself into
 *  the learned value in one step — a real observation still moves the
 *  value over several calls, just not all at once from one outlier. */
function blendObservation(
  currentValue: number,
  newObservation: number,
  clampMin: number,
  clampMax: number,
  alpha: number,
  maxStepFraction?: number,
): number {
  let newValue = Math.max(clampMin, Math.min(clampMax, currentValue * (1 - alpha) + newObservation * alpha))
  if (maxStepFraction != null) {
    const maxStep = maxStepFraction * (clampMax - clampMin)
    const delta = newValue - currentValue
    if (Math.abs(delta) > maxStep) {
      newValue = Math.max(clampMin, Math.min(clampMax, currentValue + Math.sign(delta) * maxStep))
    }
  }
  return newValue
}

/** Update a learned parameter with EMA (exponential moving average).
 *  alphaOverride: use a fixed blend rate instead of the default schedule
 *    (0.5 for the first 5 samples, 0.2 after) — e.g. for parameters that
 *    feed directly into a control law's gains rather than just a soft
 *    floor, where you want slower, steadier convergence from the start.
 *  maxStepFraction: see blendObservation — optional outlier guard, off by
 *    default so existing callers are unaffected. */
export async function updateLearnedParam(
  supabase: any,
  controllerId: string,
  paramName: string,
  newObservation: number,
  clampMin: number,
  clampMax: number,
  alphaOverride?: number,
  maxStepFraction?: number,
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
  const newValue = blendObservation(currentValue, newObservation, clampMin, clampMax, alpha, maxStepFraction)

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
  private supabase: any
  private controllerId: string
  private cache = new Map<string, { value: number; sampleCount: number }>()
  private updates: Array<{ paramName: string; rounded: number; sampleCount: number }> = []
  private loaded = false

  constructor(supabase: any, controllerId: string) {
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

    const rows: LearnedRow[] = data ?? []
    for (const row of rows) {
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

  /** Compute EMA update in memory (no DB call). See updateLearnedParam for
   *  what alphaOverride/maxStepFraction do — same semantics here. */
  update(
    paramName: string,
    newObservation: number,
    clampMin: number,
    clampMax: number,
    alphaOverride?: number,
    maxStepFraction?: number,
  ): { oldValue: number; newValue: number; sampleCount: number } {
    const existing = this.cache.get(paramName)
    const sampleCount = existing?.sampleCount ?? 0
    const alpha = alphaOverride ?? (sampleCount < 5 ? 0.5 : 0.2)
    const currentValue = existing ? existing.value : newObservation
    const newValue = blendObservation(currentValue, newObservation, clampMin, clampMax, alpha, maxStepFraction)

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
  supabase: any,
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
  const rows: LearnedRow[] = data ?? []

  const result = new Map<string, { value: number; sampleCount: number }>()

  if (isMulti) {
    // Multi-controller: key = `controllerId:paramName`
    const dataMap = new Map<string, LearnedRow>(rows.map((r): [string, LearnedRow] => [`${r.controller_id}:${r.parameter_name}`, r]))
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
    const dataMap = new Map<string, LearnedRow>(rows.map((r): [string, LearnedRow] => [r.parameter_name, r]))
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
