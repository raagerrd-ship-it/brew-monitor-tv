export { BrewChart } from "./BrewChart";
export { LazyBrewChart } from "./LazyBrewChart";
export type { 
  BrewChartProps, 
  BrewChartEvent, 
  ChartDataPoint,
  ChartDataPointWithTimestamp,
  ControllerTempPoint,
  EventDisplay 
} from "./types";
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
} from "./utils";
