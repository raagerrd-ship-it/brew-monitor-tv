/**
 * Centralized "actual temperature" calculation.
 *
 * Rules:
 *  - pillCompEnabled ON + both sensors available → average(pill, probe)
 *  - pillCompEnabled OFF (or only one sensor)   → probe ?? pill
 */
export function getActualTemp(
  pillTemp: number | null | undefined,
  probeTemp: number | null | undefined,
  pillCompEnabled: boolean,
): number | null {
  const hasPill = pillTemp != null;
  const hasProbe = probeTemp != null;

  if (pillCompEnabled && hasPill && hasProbe) {
    return (pillTemp + probeTemp) / 2;
  }

  return hasProbe ? probeTemp : hasPill ? pillTemp : null;
}

/**
 * Returns a short label describing the temperature source.
 */
export function getActualTempLabel(
  pillTemp: number | null | undefined,
  probeTemp: number | null | undefined,
  pillCompEnabled: boolean,
): string {
  const hasPill = pillTemp != null;
  const hasProbe = probeTemp != null;

  if (pillCompEnabled && hasPill && hasProbe) return "(snitt)";
  if (hasProbe) return "(ctrl)";
  if (hasPill) return "(pill)";
  return "";
}

/**
 * Centralized "display target" calculation.
 *
 * Rules:
 *  - Profile target (SSOT) is the primary display value
 *  - Falls back to controller target (PID-adjusted) if no profile target
 *  - Also exposes compensation delta for UI indicators
 */
export function getDisplayTarget(
  profileTarget: number | null | undefined,
  controllerTarget: number | null | undefined,
): {
  /** The target to show the user (profile target preferred) */
  target: number | null;
  /** PID compensation: controllerTarget − profileTarget */
  compensation: number | null;
} {
  const pTarget = profileTarget ?? null;
  const cTarget = controllerTarget ?? null;

  return {
    target: pTarget ?? cTarget,
    compensation:
      pTarget != null && cTarget != null
        ? Math.round((cTarget - pTarget) * 100) / 100
        : null,
  };
}
