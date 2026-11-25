import { BrewData } from "@/types/brew";

/**
 * Convert a color to proper opacity format
 * Handles hsl(var(--x)), hsl(h s% l%), and other color formats
 */
export function colorWithOpacity(color: string, opacity: number): string {
  // If it's an hsl(var(--x)) format, convert to hsl(var(--x) / opacity)
  if (color.startsWith('hsl(var(')) {
    const varName = color.match(/hsl\(var\((--[^)]+)\)\)/)?.[1];
    if (varName) {
      return `hsl(var(${varName}) / ${opacity})`;
    }
  }
  // If it's hsl(h s% l%) format, convert to hsl(h s% l% / opacity)
  if (color.startsWith('hsl(') && !color.includes('/')) {
    return color.replace(')', ` / ${opacity})`);
  }
  // For hex or other formats, use color-mix
  return `color-mix(in srgb, ${color} ${Math.round(opacity * 100)}%, transparent)`;
}

/**
 * Check if brew status indicates inactive state (Conditioning or Completed)
 */
/** Levererad effekt i procent, klämd till 0–100 (snapshot duty_pct kan överstiga 100 när PWM-fönstret är längre än antaget). */
export function toDutyPct(v: number | null | undefined): number {
  return Math.round(Math.max(0, Math.min(100, v ?? 0)));
}

/** Jäsfart i SG per dygn skalad till 0–100 mot max 0,010/dygn, klämd. */
export function toRatePct(v: number | null | undefined): number {
  return Math.round(Math.max(0, Math.min(100, ((v ?? 0) / 0.01) * 100)));
}

export function isBrewInactive(status: string): boolean {
  return status === "Konditionering" || status === "Klar";
}

/**
 * Calculate days since fermentation started (or days of active fermentation if end date is set)
 */
export function calculateDaysSinceStart(
  sgData: Array<{ date: string; value: number; temp: number }>,
  fermentationEnd?: string | null,
  fermentationStart?: string | null
): number {
  if (!fermentationStart && sgData.length === 0) return 0;
  
  const sortedData = [...sgData].sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  const firstDate = new Date(fermentationStart ?? sortedData[0].date);
  const endDate = fermentationEnd ? new Date(fermentationEnd) : new Date();
  return Math.floor(
    (endDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)
  );
}

/** Prefer pitch/start; without it, recorded SG and at least 2% attenuation establish fermentation. */
export function isPrePitch(brew: BrewData): boolean {
  const start = brew.fermentationStart ? new Date(brew.fermentationStart).getTime() : NaN;
  const attenuation = brew.originalGravity > 1 ? (brew.originalGravity - brew.currentSG) / (brew.originalGravity - 1) * 100 : 0;
  return (!Number.isFinite(start) && !(brew.sgData.length > 0 && attenuation >= 2)) || start > Date.now() || (brew.fermentationMetrics?.fermentation_phase === "lag" && attenuation < 2);
}

/**
 * Get status display text including fermentation day count
 */
export function getStatusDisplayText(brew: BrewData): string {
  // Mottagen från Brew Master men ännu inte i någon tank.
  if ((brew.status === "Jäsning" || brew.status === "Fermenting") && !brew.linked_controller_id && !brew.linked_pill_id && brew.sgData.length === 0 && !brew.frozen) return "Väntar på jästank";
  if ((brew.status === "Jäsning" || brew.status === "Fermenting") && (brew.fermentationStart || brew.sgData.length > 0)) {
    const daysSinceStart = Math.max(0, calculateDaysSinceStart(brew.sgData, null, brew.fermentationStart) + 1);
    return `${brew.status} dag ${daysSinceStart}`;
  }
  if ((brew.status === "Konditionering" || brew.status === "Klar") && brew.sgData.length > 0 && brew.fermentationEnd) {
    const fermDays = calculateDaysSinceStart(brew.sgData, brew.fermentationEnd, brew.fermentationStart);
    return `${brew.status} (${fermDays}d jäsning)`;
  }
  return brew.status;
}

