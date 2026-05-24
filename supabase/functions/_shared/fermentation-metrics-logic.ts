import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { SgDataPoint } from './types.ts'
import { fetchSgDataBatch } from './types.ts'

// ─── Types ────────────────────────────────────────────────────────────

type FermentationPhase = 'unknown' | 'lag' | 'exponential' | 'stationary' | 'declining'

export interface MetricsResult {
  ok: boolean
  updated: number
  metrics: { brew_id: string; phase: string; activity: number; eta_h: number | null }[]
}

// ─── Phase determination ──────────────────────────────────────────────

function determineFermentationPhase(
  sgData: SgDataPoint[],
  fermentationStartMs: number,
): { phase: FermentationPhase; sgRatePerHour: number } {
  if (sgData.length < 3) return { phase: 'unknown', sgRatePerHour: 0 }

  const sorted = [...sgData].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  const now = Date.now()

  const sixHoursAgo = now - 6 * 60 * 60 * 1000
  const recent = sorted.filter(p => new Date(p.date).getTime() > sixHoursAgo)
  if (recent.length < 2) return { phase: 'unknown', sgRatePerHour: 0 }

  const newest = recent[0]
  const oldest = recent[recent.length - 1]
  const hours = (new Date(newest.date).getTime() - new Date(oldest.date).getTime()) / (1000 * 60 * 60)
  // BLE pushes every minute, so 1h of samples is enough for a stable derivative
  // (was 3h when we only had 15-min RAPT polls).
  if (hours < 1) return { phase: 'unknown', sgRatePerHour: 0 }

  const sgDrop = oldest.value - newest.value
  const sgRatePerHour = sgDrop / hours
  const sgRatePerDay = sgRatePerHour * 24

  // Peak rate using sliding window
  const chronological = [...sorted].reverse()
  let peakRatePerDay = 0
  let windowStart = 0
  for (let windowEnd = 1; windowEnd < chronological.length; windowEnd++) {
    const endTime = new Date(chronological[windowEnd].date).getTime()
    while (windowStart < windowEnd) {
      const spanH = (endTime - new Date(chronological[windowStart].date).getTime()) / (1000 * 60 * 60)
      if (spanH <= 18) break
      windowStart++
    }
    const startTime = new Date(chronological[windowStart].date).getTime()
    const h = (endTime - startTime) / (1000 * 60 * 60)
    if (h >= 6) {
      const drop = chronological[windowStart].value - chronological[windowEnd].value
      const rate = (drop / h) * 24
      if (rate > peakRatePerDay) peakRatePerDay = rate
    }
  }

  const hoursSinceStart = (now - fermentationStartMs) / (1000 * 60 * 60)

  if (hoursSinceStart < 12 && sgRatePerDay < 0.002) return { phase: 'lag', sgRatePerHour }
  if (peakRatePerDay > 0 && sgRatePerDay > peakRatePerDay * 0.6) return { phase: 'exponential', sgRatePerHour }
  if (sgRatePerDay < 0.001) return { phase: 'stationary', sgRatePerHour }
  return { phase: 'declining', sgRatePerHour }
}

// ─── Activity score ───────────────────────────────────────────────────

function calculateActivityScore(
  deltas: { delta: number; recorded_at?: string }[],
  peakDelta: number,
  sgRatePerHour: number,
  peakSgRatePerHour: number,
): number {
  const SG_RATE_FLOOR = 0.00004
  const SG_RATE_HIGH = 0.000250

  let deltaScore = 0
  if (deltas.length > 0 && peakDelta > 0) {
    // Time-based recency: average deltas from the last 90 min.
    // Falls back to first N samples if timestamps are missing.
    const cutoff = Date.now() - 90 * 60 * 1000
    const recent = deltas.filter(d => d.recorded_at && new Date(d.recorded_at).getTime() > cutoff)
    const window = recent.length > 0 ? recent : deltas.slice(0, Math.min(6, deltas.length))
    const recentAvg = window.reduce((sum, d) => sum + Math.abs(d.delta), 0) / window.length
    deltaScore = recentAvg / peakDelta
  }

  let sgScore = 0
  if (peakSgRatePerHour > SG_RATE_FLOOR && sgRatePerHour > SG_RATE_FLOOR) {
    const relativeScore = Math.min(1, sgRatePerHour / peakSgRatePerHour)
    const absoluteFactor = Math.min(1, (sgRatePerHour - SG_RATE_FLOOR) / (SG_RATE_HIGH - SG_RATE_FLOOR))
    sgScore = relativeScore * absoluteFactor
  }

  if (sgRatePerHour < SG_RATE_FLOOR) return 0

  const blended = Math.max(deltaScore * 0.7, sgScore) * 0.6 + Math.min(deltaScore, sgScore) * 0.4
  return Math.max(0, Math.min(100, Math.round(blended * 100)))
}

// ─── Main exported function ───────────────────────────────────────────

export interface ComputeMetricsOpts {
  /** Pre-fetched fermenting brews — skips DB query if provided */
  brews?: any[]
  /** Pre-fetched running sessions — skips DB query if provided */
  sessions?: any[]
  /** Pre-fetched brew_fermentation_metrics — skips peak query if provided */
  existingMetrics?: any[]
}

export async function computeAllMetrics(
  supabase: any,
  opts?: ComputeMetricsOpts,
): Promise<MetricsResult> {
  // Get all actively fermenting brews (skip if injected)
  let brews: any[]
  if (opts?.brews) {
    brews = opts.brews
  } else {
    const { data } = await supabase
      .from('brew_readings')
      .select('id, name, original_gravity, final_gravity, current_sg, fermentation_start, linked_controller_id, status, attenuation, style')
      .in('status', ['Fermenting', 'Jäsning'])
    brews = data || []
  }

  if (brews.length === 0) {
    return { ok: true, updated: 0, metrics: [] }
  }

  // Get existing metrics for peak values (skip if injected)
  const brewIds = brews.map(b => b.id)
  let existingMetricsData: any[]
  if (opts?.existingMetrics) {
    existingMetricsData = opts.existingMetrics.filter((m: any) => brewIds.includes(m.brew_id))
  } else {
    const { data } = await supabase
      .from('brew_fermentation_metrics')
      .select('brew_id, peak_delta, peak_sg_rate_per_hour')
      .in('brew_id', brewIds)
    existingMetricsData = data || []
  }

  const existingPeakMap = new Map<string, { peakDelta: number; peakSgRate: number }>()
  ;(existingMetricsData).forEach((m: any) => {
    existingPeakMap.set(m.brew_id, {
      peakDelta: parseFloat(String(m.peak_delta)),
      peakSgRate: parseFloat(String(m.peak_sg_rate_per_hour || 0)),
    })
  })

  // Get delta history for linked controllers
  const controllerIds = brews.filter(b => b.linked_controller_id).map(b => b.linked_controller_id!)
  const deltaMap = new Map<string, { delta: number; recorded_at: string }[]>()
  if (controllerIds.length > 0) {
    const scaledLimit = Math.min(200 * controllerIds.length, 1000)
    const { data: deltas } = await supabase
      .from('temp_delta_history')
      .select('controller_id, delta, recorded_at')
      .in('controller_id', controllerIds)
      .order('recorded_at', { ascending: false })
      .limit(scaledLimit)

    ;(deltas || []).forEach((d: any) => {
      const list = deltaMap.get(d.controller_id) || []
      list.push({ delta: parseFloat(String(d.delta)), recorded_at: d.recorded_at })
      deltaMap.set(d.controller_id, list)
    })
  }

  // Check running fermentation sessions (skip if injected)
  let sessionsData: any[]
  if (opts?.sessions) {
    sessionsData = opts.sessions.filter((s: any) => s.status === 'running' && brewIds.includes(s.brew_id))
  } else {
    const { data } = await supabase
      .from('fermentation_sessions')
      .select('id, brew_id, status')
      .eq('status', 'running')
      .in('brew_id', brewIds)
    sessionsData = data || []
  }

  const sessionBrewIds = new Set(sessionsData.map((s: any) => s.brew_id))

  // Fetch SG data from snapshots (SSOT) instead of sg_data field
  const snapshotSgMap = opts?.brews
    ? await fetchSgDataBatch(supabase, brewIds)
    : await fetchSgDataBatch(supabase, brewIds)

  const upserts: any[] = []

  for (const brew of brews) {
    const allSgData = snapshotSgMap.get(brew.id) || []
    const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000
    const sgData = allSgData.filter(p => new Date(p.date).getTime() > fourteenDaysAgo)
    if (sgData.length < 3) continue

    const fermentationStartMs = brew.fermentation_start
      ? new Date(brew.fermentation_start).getTime()
      : new Date(sgData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0].date).getTime()

    const { phase, sgRatePerHour } = determineFermentationPhase(sgData, fermentationStartMs)

    const deltas = brew.linked_controller_id ? (deltaMap.get(brew.linked_controller_id) || []) : []
    const existing = existingPeakMap.get(brew.id) || { peakDelta: 0, peakSgRate: 0 }
    const currentMaxDelta = deltas.length > 0 ? Math.max(...deltas.map(d => Math.abs(d.delta))) : 0
    const peakDelta = Math.max(existing.peakDelta, currentMaxDelta)
    const peakSgRatePerHour = Math.max(existing.peakSgRate, sgRatePerHour)
    const activityScore = calculateActivityScore(deltas, peakDelta, sgRatePerHour, peakSgRatePerHour)

    const fg = parseFloat(String(brew.final_gravity))
    const currentSg = parseFloat(String(brew.current_sg))
    let etaToFgHours: number | null = null
    if (sgRatePerHour > 0.00001 && currentSg > fg) {
      etaToFgHours = Math.round((currentSg - fg) / sgRatePerHour)
      if (etaToFgHours > 720) etaToFgHours = null
    }

    const og = parseFloat(String(brew.original_gravity))
    const attRange = og - fg
    const currentAtt = attRange > 0 ? ((og - currentSg) / attRange) * 100 : 0

    const sorted = [...sgData].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    const fortyEightHoursAgo = Date.now() - 48 * 60 * 60 * 1000
    const recentSg = sorted.filter(p => new Date(p.date).getTime() > fortyEightHoursAgo)
    let sgStable48h = false
    if (recentSg.length >= 4) {
      const maxSg = Math.max(...recentSg.map(p => p.value))
      const minSg = Math.min(...recentSg.map(p => p.value))
      // Tightened from 0.002 — BLE EMA noise floor is ~0.0003, so 0.001 still leaves
      // 3× headroom against bus noise while detecting true crash-ready state sooner.
      sgStable48h = (maxSg - minSg) < 0.001
    }

    const readyToCrash = sgStable48h && currentAtt > 70 && activityScore < 15 && phase === 'stationary'

    // Predicted SG curve
    const styleLower = (brew.style || '').toLowerCase()
    let k = 0.015
    if (styleLower.includes('lager') || styleLower.includes('pilsner')) k = 0.01
    else if (styleLower.includes('saison') || styleLower.includes('belgian')) k = 0.025
    else if (styleLower.includes('ipa') || styleLower.includes('ale')) k = 0.02

    if (sgData.length >= 6 && og > fg) {
      const midIdx = Math.floor(sgData.length / 2)
      const midPoint = [...sgData].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[midIdx]
      const midHours = (new Date(midPoint.date).getTime() - fermentationStartMs) / (1000 * 60 * 60)
      const midSg = midPoint.value
      if (midHours > 6 && midSg < og && midSg > fg) {
        const ratio = (midSg - fg) / (og - fg)
        if (ratio > 0.01 && ratio < 1) {
          const adaptedK = -Math.log(ratio) / midHours
          k = k * 0.3 + adaptedK * 0.7
        }
      }
    }

    const predictedSgCurve: { date: string; sg: number }[] = []
    const maxHours = 720
    for (let i = 0; i < 8; i++) {
      const t = (i / 7) * maxHours
      const predictedSg = fg + (og - fg) * Math.exp(-k * t)
      const pointDate = new Date(fermentationStartMs + t * 60 * 60 * 1000).toISOString()
      predictedSgCurve.push({ date: pointDate, sg: Math.round(predictedSg * 10000) / 10000 })
    }

    upserts.push({
      brew_id: brew.id,
      fermentation_phase: phase,
      activity_score: activityScore,
      sg_rate_per_hour: Math.round(sgRatePerHour * 1000000) / 1000000,
      eta_to_fg_hours: etaToFgHours,
      peak_delta: peakDelta,
      peak_sg_rate_per_hour: Math.round(peakSgRatePerHour * 1000000) / 1000000,
      ready_to_crash: readyToCrash,
      ready_to_crash_at: readyToCrash ? new Date().toISOString() : null,
      predicted_sg_curve: predictedSgCurve,
      updated_at: new Date().toISOString(),
    })
  }

  let updated = 0
  if (upserts.length > 0) {
    const { error } = await supabase
      .from('brew_fermentation_metrics')
      .upsert(upserts, { onConflict: 'brew_id' })

    if (error) {
      console.error('Error upserting metrics:', error)
    } else {
      updated = upserts.length
    }
  }

  // Log READY_TO_CRASH events
  const readyBrews = upserts.filter(u => u.ready_to_crash)
  for (const rb of readyBrews) {
    if (sessionBrewIds.has(rb.brew_id)) {
      const { data: existingLog } = await supabase
        .from('fermentation_step_log')
        .select('id')
        .eq('action', 'ready_to_crash')
        .in('session_id', sessionsData.filter((s: any) => s.brew_id === rb.brew_id).map((s: any) => s.id))
        .limit(1)

      if (!existingLog || existingLog.length === 0) {
        const session = sessionsData.find((s: any) => s.brew_id === rb.brew_id)
        if (session) {
          await supabase.from('fermentation_step_log').insert({
            session_id: session.id,
            step_index: 0,
            action: 'ready_to_crash',
            details: {
              phase: rb.fermentation_phase,
              activity_score: rb.activity_score,
              message: 'Redo för cold crash - SG stabil, låg aktivitet',
            },
          })
          console.log(`🧊 READY_TO_CRASH logged for brew ${rb.brew_id}`)
        }
      }
    }
  }

  console.log(`Computed metrics for ${updated} brews: ${upserts.map(u => `${u.fermentation_phase}(${u.activity_score}%)`).join(', ')}`)

  return {
    ok: true,
    updated,
    metrics: upserts.map(u => ({ brew_id: u.brew_id, phase: u.fermentation_phase, activity: u.activity_score, eta_h: u.eta_to_fg_hours })),
  }
}
