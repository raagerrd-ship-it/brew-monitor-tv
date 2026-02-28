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
  if (hasProbe) return "(probe)";
  if (hasPill) return "(pill)";
  return "";
}
