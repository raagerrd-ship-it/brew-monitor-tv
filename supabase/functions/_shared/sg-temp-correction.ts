import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { updateLearnedParam, getLearnedParam } from './learning-utils.ts'
import type { SgDataPoint } from './types.ts'

// ============================================================
// SG Temperature Correction — Standard formula + per-pill residual
// ============================================================

/**
 * ASBC-based polynomial correction for SG at a given temperature.
 * Corrects raw SG reading to a reference temperature (default 20°C).
 * Source: ASBC Methods of Analysis, polynomial fit for water density.
 */
export function standardSgCorrection(sg: number, tempC: number, refTemp = 20): number {
  // Polynomial coefficients for density of water correction
  // Based on the simplified ASBC correction formula
  const correction = (
    1.313454 - 0.132674e-2 * tempC + 0.2057793e-5 * tempC ** 2 - 0.2627634e-8 * tempC ** 3
  ) - (
    1.313454 - 0.132674e-2 * refTemp + 0.2057793e-5 * refTemp ** 2 - 0.2627634e-8 * refTemp ** 3
  )
  return sg + correction
}

/**
 * Apply full SG temperature correction: standard formula + learned pill residual.
 * residualPerDegree is the per-pill learned drift factor (SG units per °C).
 */
export function applySgCorrection(
  sg: number,
  tempC: number,
  residualPerDegree: number,
  refTemp = 20
): number {
  const standardCorrected = standardSgCorrection(sg, tempC, refTemp)
  // Residual correction: compensate for pill-specific drift
  const residualCorrection = residualPerDegree * (tempC - refTemp)
  return standardCorrected - residualCorrection
}

/**
 * Detect a calibration anchor point from SG history.
 * An anchor is set when SG has been stable (< 0.001/h for 12h+)
 * and temperature starts dropping (> 2°C drop in recent data).
 * Returns the anchor point or null if conditions aren't met.
 */
export function detectAnchorPoint(
  sgData: SgDataPoint[],
  minStableHours = 12,
  minTempDrop = 2
): { sg: number; temp: number; recordedAt: string } | null {
  if (!sgData || sgData.length < 6) return null

  const sorted = [...sgData].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  )

  const now = new Date(sorted[sorted.length - 1].date).getTime()
  const twelveHoursAgo = now - minStableHours * 60 * 60 * 1000

  // Get data from the stable window
  const stableWindow = sorted.filter(
    d => new Date(d.date).getTime() >= twelveHoursAgo
  )
  if (stableWindow.length < 4) return null

  // Check SG stability: max rate < 0.001/h
  const firstStable = stableWindow[0]
  const lastStable = stableWindow[stableWindow.length - 1]
  const stableHours =
    (new Date(lastStable.date).getTime() - new Date(firstStable.date).getTime()) /
    (1000 * 60 * 60)
  if (stableHours < minStableHours * 0.5) return null // Need at least half the window

  const sgDelta = Math.abs(lastStable.value - firstStable.value)
  const sgRatePerHour = sgDelta / stableHours
  if (sgRatePerHour > 0.001) return null // SG still changing too fast

  // Check temperature drop
  const tempDrop = firstStable.temp - lastStable.temp
  if (tempDrop < minTempDrop) return null // Not enough temp drop

  // Use the SG from the start of the stable window (before temp started dropping)
  // Find the point where temp was highest in the stable window
  const highTempPoint = stableWindow.reduce(
    (best, d) => (d.temp > best.temp ? d : best),
    stableWindow[0]
  )

  return {
    sg: highTempPoint.value,
    temp: highTempPoint.temp,
    recordedAt: highTempPoint.date,
  }
}

/**
 * Calculate the pill-specific SG residual from an anchor point and current reading.
 * Returns the residual per degree (SG units / °C) or null if invalid.
 */
export function calculateResidual(
  anchorSg: number,
  anchorTemp: number,
  currentSg: number,
  currentTemp: number
): number | null {
  const tempDelta = currentTemp - anchorTemp
  if (Math.abs(tempDelta) < 1) return null // Not enough temp change

  // Standard correction for both anchor and current
  const anchorCorrected = standardSgCorrection(anchorSg, anchorTemp)
  const currentCorrected = standardSgCorrection(currentSg, currentTemp)

  // The residual is what remains after standard correction
  // At the anchor, SG was stable → any SG change is drift
  const sgDrift = currentCorrected - anchorCorrected
  const residualPerDegree = sgDrift / tempDelta

  return residualPerDegree
}

// ── Database integration ──

const RESIDUAL_PARAM_PREFIX = 'sg_residual_per_degree'
const RESIDUAL_CLAMP_MIN = 0
const RESIDUAL_CLAMP_MAX = 0.0003

function residualParamName(pillId: string): string {
  return `${RESIDUAL_PARAM_PREFIX}:${pillId}`
}

/**
 * Get the learned SG residual for a specific pill.
 * Uses fermentation_learnings table via learning-utils.
 * The controller_id field stores the pill_id for SG corrections.
 */
export async function getLearnedResidual(
  supabase: ReturnType<typeof createClient>,
  pillId: string
): Promise<{ residualPerDegree: number; sampleCount: number }> {
  const { value, sampleCount } = await getLearnedParam(
    supabase,
    pillId, // stored in controller_id column
    residualParamName(pillId),
    0 // default: no correction
  )
  return { residualPerDegree: value, sampleCount }
}

/**
 * Update the learned SG residual for a pill using EMA.
 */
export async function updateLearnedResidual(
  supabase: ReturnType<typeof createClient>,
  pillId: string,
  newResidual: number
): Promise<{ oldValue: number; newValue: number; sampleCount: number }> {
  return updateLearnedParam(
    supabase,
    pillId,
    residualParamName(pillId),
    Math.abs(newResidual), // Store absolute value (drift is always negative direction)
    RESIDUAL_CLAMP_MIN,
    RESIDUAL_CLAMP_MAX
  )
}

/**
 * Process SG calibration for a pill during sync.
 * - Detects anchor points automatically
 * - Learns residual during cold crash
 * - Returns the correction to apply
 */
export async function processSgCalibration(
  supabase: ReturnType<typeof createClient>,
  pillId: string,
  sgData: SgDataPoint[]
): Promise<{ residualPerDegree: number; calibrationStatus: string }> {
  // Get current calibration state
  const { data: calibration } = await supabase
    .from('pill_sg_calibration')
    .select('*')
    .eq('pill_id', pillId)
    .maybeSingle()

  const status = calibration?.status || 'idle'

  // Get learned residual (may already exist from previous cold crashes)
  const { residualPerDegree, sampleCount } = await getLearnedResidual(supabase, pillId)

  if (status === 'idle' || status === 'calibrated') {
    // Try to detect a new anchor point
    const anchor = detectAnchorPoint(sgData)
    if (anchor) {
      await supabase.from('pill_sg_calibration').upsert({
        pill_id: pillId,
        anchor_sg: anchor.sg,
        anchor_temp: anchor.temp,
        anchor_recorded_at: anchor.recordedAt,
        status: 'anchored',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'pill_id' })

      console.log(
        `🎯 SG calibration anchor set for pill ${pillId}: ` +
        `SG=${anchor.sg.toFixed(4)} @ ${anchor.temp.toFixed(1)}°C`
      )
      return { residualPerDegree, calibrationStatus: 'anchored' }
    }
  }

  if (status === 'anchored' || status === 'learning') {
    // We have an anchor — check if we can learn from current data
    if (!calibration?.anchor_sg || !calibration?.anchor_temp) {
      return { residualPerDegree, calibrationStatus: status }
    }

    const latestPoint = sgData[sgData.length - 1]
    if (!latestPoint) return { residualPerDegree, calibrationStatus: status }

    const tempDelta = latestPoint.temp - calibration.anchor_temp
    if (tempDelta > -2) {
      // Not enough cooling yet
      return { residualPerDegree, calibrationStatus: status }
    }

    // Calculate residual from current reading vs anchor
    const residual = calculateResidual(
      calibration.anchor_sg,
      calibration.anchor_temp,
      latestPoint.value,
      latestPoint.temp
    )

    if (residual !== null) {
      const result = await updateLearnedResidual(supabase, pillId, residual)

      await supabase.from('pill_sg_calibration').update({
        status: 'learning',
        updated_at: new Date().toISOString(),
      }).eq('pill_id', pillId)

      console.log(
        `📐 SG residual learned for pill ${pillId}: ` +
        `${result.oldValue.toFixed(6)} → ${result.newValue.toFixed(6)}/°C ` +
        `(sample #${result.sampleCount}, tempΔ=${tempDelta.toFixed(1)}°C)`
      )

      return { residualPerDegree: result.newValue, calibrationStatus: 'learning' }
    }
  }

  return { residualPerDegree, calibrationStatus: status }
}
