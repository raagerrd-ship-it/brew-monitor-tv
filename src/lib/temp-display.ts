/**
 * Centralized "actual temperature" calculation.
 *
 * SSOT: actual_temp is pre-calculated by the sync engine and stored on the controller.
 * This function provides a fallback for cases where actual_temp isn't available yet.
 */
export function getActualTemp(
  pillTemp: number | null | undefined,
  probeTemp: number | null | undefined,
  _pillCompEnabled?: boolean, // deprecated, kept for backward compat
): number | null {
  const hasPill = pillTemp != null;
  const hasProbe = probeTemp != null;

  return hasProbe ? probeTemp : hasPill ? pillTemp : null;
}

/**
 * Returns a short label describing the temperature source.
 */
/** @deprecated No longer shown in UI — kept for backward compat */
export function getActualTempLabel(
  _pillTemp: number | null | undefined,
  _probeTemp: number | null | undefined,
  _pillCompEnabled: boolean,
): string {
  return "";
}

/**
 * Centralized "display target" calculation.
 *
 * SSOT:
 *   actualTarget    = profile_target_temp (what the user set)
 *   ctrlTargetPid   = target_temp on hardware (PID-adjusted)
 *   pidCompensation = ctrlTargetPid − actualTarget
 */
export function getDisplayTarget(
  profileTarget: number | null | undefined,
  controllerTarget: number | null | undefined,
): {
  /** The target to show the user (actualTarget preferred) */
  actualTarget: number | null;
  /** PID compensation: ctrlTargetPid − actualTarget */
  pidCompensation: number | null;
} {
  const pTarget = profileTarget ?? null;
  const cTarget = controllerTarget ?? null;

  return {
    actualTarget: pTarget ?? cTarget,
    pidCompensation:
      pTarget != null && cTarget != null
        ? Math.round((cTarget - pTarget) * 100) / 100
        : null,
  };
}
