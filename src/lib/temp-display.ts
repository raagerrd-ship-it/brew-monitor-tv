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
