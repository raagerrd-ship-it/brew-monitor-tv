// ============================================================
// Dual Sensor Fusion
//
// Pure function that computes the fused "actual temperature"
// from two temperature sensors (pill + probe).
//
// Formula (enabled):
//   actualTemp = (pillTemp + probeTemp) / 2
//
// Formula (disabled or single sensor):
//   actualTemp = probeTemp ?? pillTemp
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
}

/**
 * Compute the fused actual temperature from two sensors.
 *
 * When enabled and both sensors are available:
 *   actualTemp = (pill + probe) / 2
 *
 * When disabled or only one sensor:
 *   actualTemp = probe ?? pill ?? profileTarget
 */
export function computeDualSensorTarget(
  profileTarget: number,
  probeTemp: number | null,
  pillTemp: number | null,
  enabled: boolean,
  preferredSensor: 'pill' | 'probe' = 'pill',
): DualSensorResult {
  const hasProbe = probeTemp != null
  const hasPill = pillTemp != null
  const dualActive = enabled && hasProbe && hasPill

  if (dualActive) {
    return {
      enabled: true,
      actualTemp: (pillTemp! + probeTemp!) / 2,
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
