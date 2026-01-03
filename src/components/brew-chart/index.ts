export { BrewChart } from "./BrewChart";
export type { 
  BrewChartProps, 
  BrewChartEvent, 
  ChartDataPoint,
  ChartDataPointWithTimestamp,
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
} from "./utils";
