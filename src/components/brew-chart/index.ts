// Components
export { BrewChart } from "./BrewChart";
export { LazyBrewChart } from "./LazyBrewChart";
export { DayBoundaryLines, EventMarkerLines } from "./ChartReferenceLines";
export { ChartXAxis, SGYAxis, TempYAxis } from "./ChartAxes";
export { SGLine, ControllerTempArea, PillTempLine } from "./ChartDataSeries";
export { ChartTooltip } from "./ChartTooltipContent";

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
  downsampleForTvMode,
} from "./utils";
