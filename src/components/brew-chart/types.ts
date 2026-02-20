export interface ChartDataPoint {
  date: string;
  value: number;
  temp: number;
  pillTemp?: number;
  controllerTemp?: number | null;
  targetTemp?: number | null;
  avgTemp?: number | null;
  /** Delta between pill and controller for stacked area span rendering */
  tempSpan?: number | null;
  // Raw (unsmoothed) values for tooltip display
  rawValue?: number;
  rawPillTemp?: number;
  rawControllerTemp?: number | null;
  rawAvgTemp?: number | null;
}

export interface ChartDataPointWithTimestamp extends ChartDataPoint {
  timestamp: number;
}

export interface ControllerTempPoint {
  recorded_at: string;
  current_temp: number;
  target_temp: number;
}

export interface BrewChartEvent {
  id: string;
  event_type: string;
  event_date: string;
  notes: string | null;
}

export interface BrewChartEventWithTimestamp extends BrewChartEvent {
  timestamp: number;
}

export interface BrewChartProps {
  data: ChartDataPoint[];
  og: number;
  fg: number;
  singleView?: boolean;
  events?: BrewChartEvent[];
  controllerId?: string | null;
  /** Index for staggered rendering - prevents all charts from loading at once */
  chartIndex?: number;
  /** Brew ID for server-rendered chart in TV mode */
  brewId?: string;
  /** Whether a fermentation session is active (affects TV chart aspect ratio) */
  hasFermentationSession?: boolean;
  /** Raw last_update timestamp - used to trigger chart refresh when data changes */
  lastUpdateRaw?: string | null;
  /** Number of brews displayed - affects TV chart viewBox proportions */
  brewCount?: number;
  /** Externally controlled smooth lines state */
  smoothLines?: boolean;
  /** Callback when smooth lines state changes */
  onSmoothLinesChange?: (value: boolean) => void;
}

export interface EventDisplay {
  label: string;
  color: string;
}
