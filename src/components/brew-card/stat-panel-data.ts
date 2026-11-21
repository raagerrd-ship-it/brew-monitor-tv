import { BrewData } from "@/types/brew";
import { calculateDaysSinceStart, isBrewInactive } from "./utils";

export const clampPct = (value: number) => Math.max(0, Math.min(100, value));

export function gravityPanelData(brew: BrewData, hideReadyToCrash = false) {
  const inactive = isBrewInactive(brew.status);
  const prePitch = !inactive && (calculateDaysSinceStart(brew.sgData) === 0 || brew.fermentationMetrics?.fermentation_phase === "lag");
  const ready = !!brew.fermentationMetrics?.ready_to_crash && !hideReadyToCrash;
  const stalled = !inactive && !prePitch && !ready && brew.fermentationRate !== null && brew.fermentationRate <= 0.002;
  const rate = brew.fermentationTrend?.rate6h ?? brew.fermentationRate;
  const showRate = !inactive && !prePitch && !stalled && !ready && rate !== null && rate > 0;
  const range = brew.originalGravity - brew.finalGravity;
  const progress = range > 0 ? clampPct((brew.originalGravity - brew.currentSG) / range * 100) : 0;
  return {
    prePitch, ready, stalled, progress,
    pointsPerDay: showRate && rate !== null ? Math.round(rate * 1000) : null,
    projected: showRate && rate !== null && range > 0 ? clampPct((brew.originalGravity - brew.currentSG + rate) / range * 100) : progress,
  };
}

export function tempScalePosition(value: number, target: number) {
  return clampPct((value - (target - 3)) / 6 * 100);
}

export function tempIsOffTarget(value: number | null, target: number | null) {
  return value !== null && target !== null && Math.abs(value - target) > 1;
}