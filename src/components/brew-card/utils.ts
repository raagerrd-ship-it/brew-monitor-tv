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
export function isBrewInactive(status: string): boolean {
  return status === "Konditionering" || status === "Klar";
}

/**
 * Calculate days since fermentation started
 */
export function calculateDaysSinceStart(sgData: Array<{ date: string; value: number; temp: number }>): number {
  if (sgData.length === 0) return 0;
  
  const sortedData = [...sgData].sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  const firstDate = new Date(sortedData[0].date);
  return Math.floor(
    (new Date().getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)
  );
}

/**
 * Get status display text including fermentation day count
 */
export function getStatusDisplayText(brew: BrewData): string {
  if (brew.status === "Jäsning" && brew.sgData.length > 0) {
    const daysSinceStart = calculateDaysSinceStart(brew.sgData);
    return `${brew.status} dag ${daysSinceStart}`;
  }
  return brew.status;
}

