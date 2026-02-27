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
  
  return 'currentColor';
}

/**
 * Convert HSL color string to RGB values
 */
export function hslToRgb(hslString: string): { r: number; g: number; b: number } {
  const match = hslString.match(/(\d+)\s*,?\s*(\d+)%\s*,?\s*(\d+)%/);
  if (!match) return { r: 200, g: 200, b: 200 };
  
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
