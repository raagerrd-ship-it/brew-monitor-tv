// ============================================================
// Dual Sensor Fusion
//
// Pure function that computes the controller base target from
// the profile target and two temperature sensors (pill + probe).
//
// Formula (enabled):
//   sensorDelta = (pillTemp - probeTemp) / 2
//   baseTarget  = profileTarget - sensorDelta
//   actualTemp  = (pillTemp + probeTemp) / 2
//
// Formula (disabled or single sensor):
//   sensorDelta = 0
//   baseTarget  = profileTarget
//   actualTemp  = probeTemp ?? pillTemp
//
// This module has NO side effects, NO DB calls, NO learned parameters.
// It is the single source of truth for sensor fusion across
// backend (edge functions) and frontend (UI display).
// ============================================================

export interface DualSensorResult {
  /** Whether dual sensor fusion is active */
  enabled: boolean
  /** Target for the controller probe (input to PID) */
  baseTarget: number
  /** (pill - probe) / 2 — the geometric correction */
  sensorDelta: number
  /** Fused temperature reading for PID error calculation */
  actualTemp: number
}

/**
 * Compute the dual-sensor-adjusted target and fused temperature.
 *
 * When enabled and both sensors are available:
 *   baseTarget = profileTarget - (pill - probe) / 2
 *   actualTemp = (pill + probe) / 2
 *
 * When disabled or only one sensor:
 *   baseTarget = profileTarget
 *   actualTemp = probe ?? pill ?? profileTarget
 */
export function computeDualSensorTarget(
  profileTarget: number,
  probeTemp: number | null,
  pillTemp: number | null,
  enabled: boolean,
): DualSensorResult {
  const hasProbe = probeTemp != null
  const hasPill = pillTemp != null
  const dualActive = enabled && hasProbe && hasPill

  if (dualActive) {
    const sensorDelta = (pillTemp! - probeTemp!) / 2
    return {
      enabled: true,
      baseTarget: Math.round((profileTarget - sensorDelta) * 10) / 10,
      sensorDelta: Math.round(sensorDelta * 100) / 100,
      actualTemp: (pillTemp! + probeTemp!) / 2,
    }
  }

  const actualTemp = hasProbe ? probeTemp! : hasPill ? pillTemp! : profileTarget
  return {
    enabled: false,
    baseTarget: profileTarget,
    sensorDelta: 0,
    actualTemp,
  }
}
