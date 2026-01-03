import { BrewData } from "@/types/brew";

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

/**
 * Get the appropriate color for a stat based on whether it's glowing
 */
export function getStatGlowStyles(isGlowing: boolean, color: string): React.CSSProperties {
  if (isGlowing) {
    return {
      boxShadow: `0 0 25px ${color}`,
      borderColor: `${color}66`
    };
  }
  return {
    boxShadow: '0 6px 20px hsl(222 30% 3% / 0.6), 0 3px 8px hsl(222 30% 3% / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.06)'
  };
}

/**
 * Calculate thermometer fill height based on temperature (0-30°C range)
 */
export function calculateThermometerFill(temp: number): number {
  return 24 - (Math.min(Math.max(temp, 0), 30) / 30) * 20;
}

/**
 * Calculate battery fill width based on percentage
 */
export function calculateBatteryFillWidth(percentage: number): number {
  return (percentage / 100) * 14;
}

/**
 * Calculate ABV fill offset for gradient
 */
export function calculateAbvFillOffset(abv: number): number {
  return 100 - Math.min((abv / 10) * 100, 100);
}
