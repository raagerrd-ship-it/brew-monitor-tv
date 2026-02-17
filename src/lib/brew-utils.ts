import { BrewData, PillData, TempController } from "@/types/brew";

/**
 * Color keywords mapped to hex values (English and Swedish)
 */
const colorMatches: Array<[string[], string]> = [
  [['red', 'röd'], '#ef4444'],
  [['blue', 'blå'], '#3b82f6'],
  [['green', 'grön'], '#22c55e'],
  [['yellow', 'gul'], '#eab308'],
  [['purple', 'lila'], '#a855f7'],
  [['pink', 'rosa'], '#ec4899'],
  [['orange'], '#f97316'],
  [['cyan'], '#06b6d4'],
  [['lime'], '#84cc16'],
  [['amber', 'bärnsten'], '#f59e0b'],
  [['teal', 'turkos'], '#14b8a6'],
  [['indigo'], '#6366f1'],
  [['violet', 'violett'], '#8b5cf6'],
  [['fuchsia'], '#d946ef'],
  [['rose'], '#f43f5e'],
  [['sky', 'himmel'], '#0ea5e9'],
  [['emerald', 'smaragd'], '#10b981'],
  [['slate', 'skiffer'], '#64748b'],
  [['gray', 'grey', 'grå'], '#6b7280'],
  [['zinc', 'zink'], '#71717a'],
  [['neutral', 'neutral'], '#737373'],
  [['stone', 'sten'], '#78716c'],
  [['white', 'vit'], '#f1f5f9'],
  [['black', 'svart'], '#1e293b'],
];

/**
 * Color keywords used for matching devices to brews
 */
export const colorKeywords = [
  'röd', 'red', 'blå', 'blue', 'grön', 'green', 'gul', 'gyllene', 'guld', 'golden', 'yellow', 
  'lila', 'purple', 'rosa', 'pink', 'orange', 'cyan', 'lime', 'amber', 'bärnsten', 
  'turkos', 'teal', 'indigo', 'violet', 'violett', 'fuchsia', 'rose', 'himmel', 'sky', 
  'smaragd', 'emerald'
];

/**
 * Extract color from controller/pill name and return hex value
 */
export function getControllerColor(name: string): string {
  const lowerName = name.toLowerCase();

  for (const [keywords, hex] of colorMatches) {
    if (keywords.some(keyword => lowerName.includes(keyword))) {
      return hex;
    }
  }
  
  // Default to primary theme color if no color found
  return 'currentColor';
}

/**
 * Convert HSL color string to RGB values
 */
export function hslToRgb(hslString: string): { r: number; g: number; b: number } {
  // Parse HSL string like "hsl(210, 100%, 50%)" or "210 100% 50%"
  const match = hslString.match(/(\d+)\s*,?\s*(\d+)%\s*,?\s*(\d+)%/);
  if (!match) return { r: 200, g: 200, b: 200 }; // Default gray
  
  const h = parseInt(match[1]) / 360;
  const s = parseInt(match[2]) / 100;
  const l = parseInt(match[3]) / 100;
  
  let r: number, g: number, b: number;
  
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  };
}

interface DeviceMatch {
  pill: PillData | null;
  controller: TempController | null;
}

/**
 * Find matching pill and controller for a brew based on:
 * 1. Manual controller connection (linked_controller_id) - pill is automatically derived from controller
 * 2. Color name matching
 * 3. Temperature matching (±3°C tolerance)
 * 
 * Note: linked_pill_id on brew is deprecated - pill is now derived from controller's linked_pill_id
 */
export function findDevicesForBrew(
  brew: BrewData,
  pills: PillData[],
  controllers: TempController[]
): DeviceMatch {
  // First, check for manual controller connection
  if (brew.linked_controller_id) {
    const manualController = controllers.find(c => c.controller_id === brew.linked_controller_id) || null;
    
    if (manualController) {
      // Get pill from controller's linked_pill_id (not from brew)
      const linkedPill = manualController.linked_pill_id 
        ? pills.find(p => p.pill_id === manualController.linked_pill_id) || null
        : null;
      
      return { pill: linkedPill, controller: manualController };
    }
  }

  // Fallback to automatic matching
  let matchingPill: PillData | null = null;
  let matchingController: TempController | null = null;

  // Try to match by color name in brew name
  const brewNameLower = brew.name.toLowerCase();

  // Find color keywords in brew name
  const brewColors = colorKeywords.filter(color => brewNameLower.includes(color));

  // Try to match controller by color first
  if (brewColors.length > 0) {
    matchingController = controllers.find(ctrl => {
      const ctrlNameLower = ctrl.name.toLowerCase();
      return brewColors.some(color => ctrlNameLower.includes(color));
    }) || null;
  }

  // If we found a controller, get its linked pill
  if (matchingController && matchingController.linked_pill_id) {
    matchingPill = pills.find(p => p.pill_id === matchingController!.linked_pill_id) || null;
  }

  // If no color match, try temperature matching (±3°C tolerance)
  if (!matchingController && !matchingPill) {
    const brewTemp = brew.currentTemp;
    
    // Try to match controller by temperature
    matchingController = controllers.find(ctrl => {
      if (ctrl.pill_temp !== null) {
        return Math.abs(ctrl.pill_temp - brewTemp) <= 3;
      }
      if (ctrl.current_temp !== null) {
        return Math.abs(ctrl.current_temp - brewTemp) <= 3;
      }
      return false;
    }) || null;

    // If controller matched, use its linked pill
    if (matchingController && matchingController.linked_pill_id) {
      matchingPill = pills.find(p => p.pill_id === matchingController!.linked_pill_id) || null;
    }
  }

  return { pill: matchingPill, controller: matchingController };
}

/**
 * Calculate fermentation rate (SG change per 24h based on recent data)
 */
export function calculateFermentationRate(
  sgData: Array<{ date: string; value: number; temp: number }>
): number | null {
  if (!sgData || sgData.length < 2) return null;
  
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  
  // Filter readings from last 24 hours
  const last24h = sgData.filter(d => new Date(d.date) >= twentyFourHoursAgo).sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  
  // If we have 24h data, use it
  if (last24h.length >= 2) {
    const firstReading = last24h[0];
    const lastReading = last24h[last24h.length - 1];
    
    const timeDiffMs = new Date(lastReading.date).getTime() - new Date(firstReading.date).getTime();
    const timeDiffHours = timeDiffMs / (1000 * 60 * 60);
    
    if (timeDiffHours === 0) return null;
    
    const sgDiff = firstReading.value - lastReading.value;
    const ratePerHour = sgDiff / timeDiffHours;
    return ratePerHour * 24;
  }
  
  // Otherwise, use max 7 days of recent data to avoid skewing by old fermentation
  const last7days = sgData.filter(d => new Date(d.date) >= sevenDaysAgo).sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  
  const dataToUse = last7days.length >= 2 ? last7days : [...sgData].sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  
  if (dataToUse.length < 2) return null;
  
  const firstReading = dataToUse[0];
  const lastReading = dataToUse[dataToUse.length - 1];
  
  const timeDiffMs = new Date(lastReading.date).getTime() - new Date(firstReading.date).getTime();
  const timeDiffHours = timeDiffMs / (1000 * 60 * 60);
  
  if (timeDiffHours === 0) return null;
  
  const sgDiff = firstReading.value - lastReading.value;
  const ratePerHour = sgDiff / timeDiffHours;
  return ratePerHour * 24;
}

/**
 * Format runtime seconds into a human-readable string (e.g., "2h 15m" or "45m")
 */
export function formatRunTime(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '0m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
