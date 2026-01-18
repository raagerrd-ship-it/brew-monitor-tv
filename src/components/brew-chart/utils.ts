import { 
  ChartDataPoint, 
  ChartDataPointWithTimestamp, 
  BrewChartEvent, 
  BrewChartEventWithTimestamp,
  EventDisplay,
  ControllerTempPoint
} from "./types";

/**
 * Interpolate controller temperature for a given timestamp
 * Uses linear interpolation between the two closest data points
 */
export function interpolateControllerTemp(
  timestamp: number,
  controllerData: ControllerTempPoint[]
): number | null {
  if (!controllerData || controllerData.length === 0) return null;

  // Convert to timestamps and sort
  const sortedData = controllerData
    .map(d => ({
      timestamp: new Date(d.recorded_at).getTime(),
      temp: d.current_temp
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  // If before first point, use first point
  if (timestamp <= sortedData[0].timestamp) {
    return sortedData[0].temp;
  }

  // If after last point, use last point
  if (timestamp >= sortedData[sortedData.length - 1].timestamp) {
    return sortedData[sortedData.length - 1].temp;
  }

  // Find surrounding points and interpolate
  for (let i = 0; i < sortedData.length - 1; i++) {
    const current = sortedData[i];
    const next = sortedData[i + 1];
    
    if (timestamp >= current.timestamp && timestamp <= next.timestamp) {
      // Linear interpolation
      const ratio = (timestamp - current.timestamp) / (next.timestamp - current.timestamp);
      return current.temp + ratio * (next.temp - current.temp);
    }
  }

  return null;
}

/**
 * Merge SG data with controller temperature data
 * Keeps pill temp and adds controller temp as separate field
 */
export function mergeWithControllerTemp(
  sgData: ChartDataPoint[],
  controllerData: ControllerTempPoint[]
): ChartDataPoint[] {
  return sgData.map(point => {
    const timestamp = new Date(point.date).getTime();
    const controllerTemp = controllerData && controllerData.length > 0 
      ? interpolateControllerTemp(timestamp, controllerData) 
      : null;
    
    return {
      ...point,
      pillTemp: point.temp,
      controllerTemp: controllerTemp
    };
  });
}

/**
 * Calculate moving average for smoother chart lines
 */
export function calculateMovingAverage(
  data: ChartDataPoint[], 
  windowSize: number,
  enabled: boolean = true
): ChartDataPoint[] {
  if (!enabled || windowSize < 2) return data;
  
  const result: ChartDataPoint[] = [];
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - Math.floor(windowSize / 2));
    const end = Math.min(data.length, i + Math.ceil(windowSize / 2));
    const window = data.slice(start, end);
    
    const avgValue = window.reduce((sum, d) => sum + d.value, 0) / window.length;
    const avgPillTemp = window.reduce((sum, d) => sum + (d.pillTemp ?? d.temp), 0) / window.length;
    const controllerTemps = window.filter(d => d.controllerTemp != null);
    const avgControllerTemp = controllerTemps.length > 0 
      ? controllerTemps.reduce((sum, d) => sum + d.controllerTemp!, 0) / controllerTemps.length 
      : null;
    
    result.push({
      ...data[i],
      value: avgValue,
      pillTemp: avgPillTemp,
      controllerTemp: avgControllerTemp
    });
  }
  return result;
}

/**
 * Convert chart data to include timestamps for linear scale
 */
export function addTimestamps(data: ChartDataPoint[]): ChartDataPointWithTimestamp[] {
  return data.map(d => ({
    ...d,
    timestamp: new Date(d.date).getTime()
  }));
}

/**
 * Generate day boundary timestamps for reference lines (midnight markers)
 */
export function generateDayBoundaries(chartData: ChartDataPointWithTimestamp[]): number[] {
  if (chartData.length === 0) return [];
  
  const dayBoundaries: number[] = [];
  const firstTimestamp = chartData[0].timestamp;
  const lastDate = new Date(chartData[chartData.length - 1].date);
  const firstDate = new Date(chartData[0].date);
  
  // Start from midnight of the first day
  const firstMidnight = new Date(firstDate);
  firstMidnight.setHours(0, 0, 0, 0);
  
  // Day boundary lines start from midnight AFTER first day
  const currentMidnight = new Date(firstMidnight);
  currentMidnight.setDate(currentMidnight.getDate() + 1);
  
  // Generate midnight for each day until the last data point
  while (currentMidnight <= lastDate) {
    dayBoundaries.push(currentMidnight.getTime());
    currentMidnight.setDate(currentMidnight.getDate() + 1);
  }
  
  return dayBoundaries;
}

/**
 * Generate unique day ticks for X-axis labels
 */
export function generateDayTicks(chartData: ChartDataPointWithTimestamp[]): number[] {
  if (chartData.length === 0) return [];
  
  const uniqueDayTicks: number[] = [];
  const firstTimestamp = chartData[0].timestamp;
  const lastTimestamp = chartData[chartData.length - 1].timestamp;
  const firstDate = new Date(chartData[0].date);
  const lastDate = new Date(chartData[chartData.length - 1].date);
  
  // First tick should be at the first data point (not midnight)
  uniqueDayTicks.push(firstTimestamp);
  
  // Start from midnight of the first day
  const firstMidnight = new Date(firstDate);
  firstMidnight.setHours(0, 0, 0, 0);
  
  // Add subsequent day ticks at midnight (only if different from first day)
  const currentDay = new Date(firstMidnight);
  currentDay.setDate(currentDay.getDate() + 1);
  while (currentDay <= lastDate) {
    const dayTimestamp = currentDay.getTime();
    // Only add if it's within the data range
    if (dayTimestamp >= firstTimestamp && dayTimestamp <= lastTimestamp) {
      uniqueDayTicks.push(dayTimestamp);
    }
    currentDay.setDate(currentDay.getDate() + 1);
  }
  
  return uniqueDayTicks;
}

/**
 * Map event type to display label and color
 */
export function getEventDisplay(type: string): EventDisplay {
  switch (type) {
    case 'jast':
      return { label: 'Jäst', color: '#eab308' }; // yellow
    case 'syresattning':
      return { label: 'Syresättning', color: '#0ea5e9' }; // cyan
    case 'diacetylrast':
      return { label: 'Diacetylrast', color: '#f97316' }; // orange
    case 'torrhumling':
      return { label: 'Torrhumling', color: '#22c55e' }; // green
    case 'coldcrash':
      return { label: 'Coldcrash', color: '#3b82f6' }; // blue
    default:
      return { label: 'Händelse', color: '#a855f7' }; // purple
  }
}

/**
 * Group events by day (keeping only one per day) and add timestamps
 */
export function getEventsPerDay(events: BrewChartEvent[]): BrewChartEventWithTimestamp[] {
  const eventsByDay = new Map<string, BrewChartEvent>();
  
  // Group events by day, keeping only one per day
  events.forEach(event => {
    const eventDate = new Date(event.event_date);
    const dayKey = `${eventDate.getFullYear()}-${eventDate.getMonth()}-${eventDate.getDate()}`;
    
    // Keep the first event of each day
    if (!eventsByDay.has(dayKey)) {
      eventsByDay.set(dayKey, event);
    }
  });
  
  return Array.from(eventsByDay.values())
    .sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime())
    .map(event => ({
      ...event,
      timestamp: new Date(event.event_date).getTime()
    }));
}

/**
 * Format timestamp for X-axis display
 */
export function formatXAxisTick(timestamp: number): string {
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '';
    const day = date.getDate();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];
    const month = monthNames[date.getMonth()];
    return `${day} ${month}`;
  } catch (e) {
    return '';
  }
}

/**
 * Format timestamp for tooltip label
 */
export function formatTooltipLabel(timestamp: number | string): string {
  try {
    const date = new Date(Number(timestamp));
    if (isNaN(date.getTime())) return String(timestamp);
    const day = date.getDate();
    const month = date.getMonth() + 1;
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${day}/${month} ${hours}:${minutes}`;
  } catch (e) {
    return String(timestamp);
  }
}

/**
 * Calculate optimal window size for moving average based on data length
 */
export function getOptimalWindowSize(dataLength: number): number {
  return Math.max(3, Math.floor(dataLength * 0.08));
}

/**
 * Downsample data for TV mode to reduce rendering load
 * Uses LTTB (Largest Triangle Three Buckets) inspired sampling
 * @param data - Original data array
 * @param maxPoints - Maximum number of points to keep (default: 100)
 * @returns Downsampled data
 */
export function downsampleForTvMode<T>(data: T[], maxPoints: number = 100): T[] {
  if (data.length <= maxPoints) return data;
  
  const result: T[] = [];
  const step = (data.length - 2) / (maxPoints - 2);
  
  // Always keep first point
  result.push(data[0]);
  
  // Sample middle points
  for (let i = 1; i < maxPoints - 1; i++) {
    const index = Math.round(1 + i * step);
    if (index < data.length - 1) {
      result.push(data[index]);
    }
  }
  
  // Always keep last point
  result.push(data[data.length - 1]);
  
  return result;
}
