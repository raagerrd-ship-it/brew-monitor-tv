// Chart styling configuration for ControllerTempChart

export const CHART_MARGINS = {
  top: 5,
  right: 5,
  left: -20,
  bottom: 5,
};

export const COLORS = {
  target: '#f59e0b', // Amber for target temp
  grid: 'hsl(var(--muted))',
};

export const AXIS_CONFIG = {
  tick: { fontSize: 10 },
  minTickGap: 40,
};

export const TOOLTIP_STYLE = {
  backgroundColor: 'hsl(var(--background))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '6px',
  fontSize: '12px',
};

export const LINE_CONFIG = {
  current: {
    strokeWidth: 2,
    dot: false,
    type: 'natural' as const,
  },
  target: {
    strokeWidth: 2,
    dot: false,
    type: 'stepAfter' as const,
    strokeDasharray: '5 5',
  },
};
