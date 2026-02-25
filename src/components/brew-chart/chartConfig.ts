// Chart styling constants
export const CHART_MARGINS = { top: 20, right: -10, left: -20, bottom: 5 };

// Colors using CSS variables
export const COLORS = {
  sg: "hsl(var(--beer-amber))",
  
  temp: "hsl(var(--temp-blue))",
  tempFaint: "hsl(var(--temp-blue) / 0.3)",
  tempFill: "hsl(var(--temp-blue) / 0.08)",
  targetTemp: "hsl(var(--temp-blue) / 0.5)",
  border: "hsl(var(--border))",
  mutedForeground: "hsl(var(--muted-foreground))",
  card: "hsl(var(--card))",
  foreground: "hsl(var(--foreground))",
} as const;

// Axis styling
export const AXIS_STYLES = {
  fontSize: {
    x: "9px",
    y: "10px",
  },
} as const;

// Line/Area styling
export const DATA_SERIES_CONFIG = {
  sg: {
    strokeWidth: 2.5,
    dotRadius: 5,
    filter: "drop-shadow(0 0 6px hsl(var(--beer-amber) / 0.6))",
  },
  avgTemp: {
    strokeWidth: 1.5,
    dotRadius: 4,
  },
  controllerTemp: {
    strokeWidth: 1,
    dotRadius: 3,
  },
  pillTemp: {
    strokeWidth: 1,
    dotRadius: 3,
  },
  targetTemp: {
    strokeWidth: 1.5,
    dotRadius: 3,
    strokeDasharray: "4 4",
  },
} as const;

// Grid styling
export const GRID_CONFIG = {
  strokeDasharray: "3 3",
  opacity: 0.3,
} as const;

// Day boundary reference line styling
export const DAY_BOUNDARY_CONFIG = {
  strokeDasharray: "2 4",
  strokeOpacity: 0.25,
  strokeWidth: 1,
} as const;

// Event marker styling
export const EVENT_MARKER_CONFIG = {
  strokeWidth: 3,
  labelConfig: {
    position: "insideTopRight" as const,
    fontSize: 14,
    fontWeight: "bold" as const,
    angle: -90,
    offset: 0,
  },
} as const;
