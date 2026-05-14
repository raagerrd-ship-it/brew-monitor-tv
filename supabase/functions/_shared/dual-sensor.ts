// ============================================================
// Dual Sensor Fusion
//
// Pure function that computes the fused "actual temperature"
// from two temperature sensors (pill + probe).
//
// Phase-aware weighting (when dual fusion is enabled):
//   probeWeight = 0.5 + 0.2 * clamp(activityScore / 60, 0, 1)
//   actualTemp  = probe * probeWeight + pill * (1 - probeWeight)
//
// Rationale: during active fermentation (high activity_score) the
// thermowell probe is the truth — Pill floats in foam/CO2 and is
// noisy. During stationary / cold-crash (activity ≈ 0) we want a
// 50/50 average so the bottom can't freeze before the top cools.
// Using activity_score as the driver gives a smooth transition
// without LERP timers.
//
// Formula (disabled or single sensor):
//   actualTemp = probeTemp ?? pillTemp  (or preferred)
//
// This module has NO side effects, NO DB calls, NO learned parameters.
// It is the single source of truth for sensor fusion across
// backend (edge functions) and frontend (UI display).
// ============================================================

export interface DualSensorResult {
  /** Whether dual sensor fusion is active */
  enabled: boolean
  /** Fused temperature reading */
  actualTemp: number
  /** Probe weight used (0..1) — only meaningful when enabled */
  probeWeight?: number
}

/**
 * Compute the fused actual temperature from two sensors.
 */
export function computeDualSensorTarget(
  profileTarget: number,
  probeTemp: number | null,
  pillTemp: number | null,
  enabled: boolean,
  preferredSensor: 'pill' | 'probe' = 'pill',
  activityScore: number | null = null,
): DualSensorResult {
  const hasProbe = probeTemp != null
  const hasPill = pillTemp != null
  const dualActive = enabled && hasProbe && hasPill

  if (dualActive) {
    // Map activity 0..60 → probe weight 0.5..0.7. Above 60 stays 0.7.
    // Null/unknown activity falls back to neutral 0.5/0.5 (safe for crash).
    const a = activityScore == null ? 0 : Math.max(0, Math.min(60, activityScore))
    const probeWeight = 0.5 + 0.2 * (a / 60)
    const pillWeight = 1 - probeWeight
    return {
      enabled: true,
      actualTemp: probeTemp! * probeWeight + pillTemp! * pillWeight,
      probeWeight,
    }
  }

  // When fusion is disabled, respect the user's preferred sensor with fallback
  let actualTemp: number
  if (preferredSensor === 'probe') {
    actualTemp = hasProbe ? probeTemp! : hasPill ? pillTemp! : profileTarget
  } else {
    actualTemp = hasPill ? pillTemp! : hasProbe ? probeTemp! : profileTarget
  }
  return {
    enabled: false,
    actualTemp,
  }
}
