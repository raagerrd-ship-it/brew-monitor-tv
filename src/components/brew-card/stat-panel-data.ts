import { BrewData } from "@/types/brew";
import { isPrePitch, isBrewInactive } from "./utils";

export const clampPct = (value: number) => Math.max(0, Math.min(100, value));

export function formatPointsPerDay(points: number) {
  return points >= 1 ? String(Math.round(points)) : points.toFixed(1).replace(".", ",");
}

export function gravityPanelData(brew: BrewData, hideReadyToCrash = false) {
  const inactive = isBrewInactive(brew.status);
  const prePitch = !inactive && isPrePitch(brew);
  const ready = inactive || (!!brew.fermentationMetrics?.ready_to_crash && !hideReadyToCrash);
  const atFg = !inactive && !prePitch && brew.currentSG <= brew.finalGravity + 0.0005;
  const stalled = !inactive && !prePitch && !ready && !atFg && brew.fermentationRate !== null && brew.fermentationRate <= 0.002;
  const rate = brew.fermentationTrend?.rate6h ?? brew.fermentationRate;
  const points = rate !== null ? rate * 1000 : null;
  const formatted = points !== null ? formatPointsPerDay(points) : null;
  const showRate = !inactive && !prePitch && !stalled && !ready && formatted !== null && formatted !== "0" && formatted !== "0,0";
  const range = brew.originalGravity - brew.finalGravity;
  const progress = range > 0 ? clampPct((brew.originalGravity - brew.currentSG) / range * 100) : 0;
  return {
    prePitch, ready, stalled, atFg, progress,
    done: inactive,
    pointsPerDay: showRate ? formatted : null,
    projected: showRate && rate !== null && range > 0 ? clampPct((brew.originalGravity - brew.currentSG + rate) / range * 100) : progress,
  };
}

export function tempScalePosition(value: number, target: number) {
  return clampPct((value - (target - 3)) / 6 * 100);
}

export function tempIsOffTarget(value: number | null, target: number | null) {
  return value !== null && target !== null && Math.abs(value - target) > 1;
}