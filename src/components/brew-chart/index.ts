// Components
export { BrewChart } from "./BrewChart";
export { LazyBrewChart } from "./LazyBrewChart";

// Hooks
export { useBrewChartData } from "./hooks/useBrewChartData";

// Config
export * from "./chartConfig";

// Types
export type { 
  BrewChartProps, 
  BrewChartEvent, 
  ChartDataPoint,
  ChartDataPointWithTimestamp,
  ControllerTempPoint,
  EventDisplay,
  BrewChartEventWithTimestamp,
} from "./types";

// Utils
export {
  calculateMovingAverage,
  addTimestamps,
  generateDayBoundaries,
  generateDayTicks,
  getEventDisplay,
  getEventsPerDay,
  formatXAxisTick,
  formatTooltipLabel,
  getOptimalWindowSize,
  mergeWithControllerTemp,
  interpolateControllerTemp,
  interpolateTargetTemp,
  downsampleForTvMode,
} from "./utils";
