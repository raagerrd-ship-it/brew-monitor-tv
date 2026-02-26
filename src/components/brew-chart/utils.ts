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
/**
 * Interpolate a value from controller data for a given timestamp
 * Uses linear interpolation between the two closest data points
 */
function interpolateValue(
  timestamp: number,
  sortedData: { timestamp: number; value: number }[]
): number | null {
  if (sortedData.length === 0) return null;

  // If before first point, use first point
  if (timestamp <= sortedData[0].timestamp) {
    return sortedData[0].value;
  }

  // If after last point, use last point
  if (timestamp >= sortedData[sortedData.length - 1].timestamp) {
    return sortedData[sortedData.length - 1].value;
  }

  // Find surrounding points and interpolate
  for (let i = 0; i < sortedData.length - 1; i++) {
    const current = sortedData[i];
    const next = sortedData[i + 1];
    
    if (timestamp >= current.timestamp && timestamp <= next.timestamp) {
      // Linear interpolation
      const ratio = (timestamp - current.timestamp) / (next.timestamp - current.timestamp);
      return current.value + ratio * (next.value - current.value);
    }
  }

  return null;
}

/**
 * Pre-sort and cache controller data for efficient lookups
 */
interface SortedControllerData {
  currentTemp: { timestamp: number; value: number }[];
  targetTemp: { timestamp: number; value: number }[];
}

function prepareControllerData(controllerData: ControllerTempPoint[]): SortedControllerData | null {
  if (!controllerData || controllerData.length === 0) return null;
  
  const currentTemp = controllerData
    .map(d => ({
      timestamp: new Date(d.recorded_at).getTime(),
      value: d.current_temp
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
    
  // Don't use controller history target_temp for the Mål line —
  // the chart gets Mål exclusively from brew_data_snapshots (via snapshotTargets).
  // We still need the sorted data structure for backward compat but set all to null.
  const targetTemp: { timestamp: number; value: number }[] = [];
    
  return { currentTemp, targetTemp };
}

/**
 * Interpolate controller temperature for a given timestamp (uses pre-sorted data)
 */
export function interpolateControllerTemp(
  timestamp: number,
  controllerData: ControllerTempPoint[]
): number | null {
  if (!controllerData || controllerData.length === 0) return null;

  const sortedData = controllerData
    .map(d => ({
      timestamp: new Date(d.recorded_at).getTime(),
      value: d.current_temp
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  return interpolateValue(timestamp, sortedData);
}

/**
 * Interpolate target temperature for a given timestamp
 * Target temp changes in steps, so we use the most recent value (no interpolation)
 */
export function interpolateTargetTemp(
  timestamp: number,
  controllerData: ControllerTempPoint[]
): number | null {
  if (!controllerData || controllerData.length === 0) return null;

  const sortedData = controllerData
    .map(d => ({
      timestamp: new Date(d.recorded_at).getTime(),
      value: d.target_temp
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  // For target temp, use step function (most recent value before timestamp)
  if (timestamp <= sortedData[0].timestamp) {
    return sortedData[0].value;
  }

  for (let i = sortedData.length - 1; i >= 0; i--) {
    if (sortedData[i].timestamp <= timestamp) {
      return sortedData[i].value;
    }
  }

  return sortedData[0].value;
}

/**
 * Merge SG data with controller temperature data
 * OPTIMIZED: Uses binary search for target temp lookup (O(log n) per point instead of O(n))
 */
export function mergeWithControllerTemp(
  sgData: ChartDataPoint[],
  controllerData: ControllerTempPoint[]
): ChartDataPoint[] {
  const prepared = prepareControllerData(controllerData);
  
  if (!prepared) {
    // No controller data - just add pillTemp field
    return sgData.map(point => ({
      ...point,
      pillTemp: point.temp,
      controllerTemp: null,
      targetTemp: null,
      avgTemp: null
    }));
  }
  
  const targetData = prepared.targetTemp;
  
  // Binary search helper for target temp (step function - find last value before timestamp)
  const findTargetTemp = (timestamp: number): number | null => {
    if (targetData.length === 0) return null;
    if (timestamp <= targetData[0].timestamp) return targetData[0].value;
    if (timestamp >= targetData[targetData.length - 1].timestamp) {
      return targetData[targetData.length - 1].value;
    }
    
    // Binary search for the rightmost element with timestamp <= target
    let left = 0;
    let right = targetData.length - 1;
    while (left < right) {
      const mid = Math.ceil((left + right + 1) / 2);
      if (targetData[mid].timestamp <= timestamp) {
        left = mid;
      } else {
        right = mid - 1;
      }
    }
    return targetData[left].value;
  };
  
  // Only use actual SG data points, enriched with controller values
  return sgData.map(point => {
    const timestamp = new Date(point.date).getTime();
    const controllerTemp = interpolateValue(timestamp, prepared.currentTemp);
    const targetTemp = findTargetTemp(timestamp);
    const avgTemp = (controllerTemp != null && point.temp != null)
      ? (controllerTemp + point.temp) / 2
      : null;
    const tempSpan = (controllerTemp != null && point.temp != null)
      ? Math.abs(point.temp - controllerTemp)
      : null;
    return {
      ...point,
      pillTemp: point.temp,
      controllerTemp,
      targetTemp,
      avgTemp,
      tempSpan
    };
  });
}

/**
 * Calculate moving average for smoother chart lines
 * TRULY OPTIMIZED: Uses proper sliding window with O(n) complexity
 * Previous implementation was O(n*windowSize) due to nested loops
 */
export function calculateMovingAverage(
   data: ChartDataPoint[], 
   windowSize: number,
   enabled: boolean = true
 ): ChartDataPoint[] {
   if (!enabled || windowSize < 2 || data.length === 0) return data;
   
   const len = data.length;
   const halfWindow = Math.floor(windowSize / 2);
   const result: ChartDataPoint[] = new Array(len);
   
   // Pre-extract values to avoid repeated property access
   const values: number[] = new Array(len);
   const valueValid: boolean[] = new Array(len);
   const pillTemps: number[] = new Array(len);
   const pillTempValid: boolean[] = new Array(len);
    const controllerTemps: number[] = new Array(len);
    const controllerValid: boolean[] = new Array(len);
    const avgTemps: number[] = new Array(len);
    const avgValid: boolean[] = new Array(len);
    
    for (let i = 0; i < len; i++) {
      const d = data[i];
      const v = d.value;
      valueValid[i] = v !== null && v !== undefined && !isNaN(v);
      values[i] = valueValid[i] ? v : 0;
      const pt = d.pillTemp ?? d.temp;
      pillTempValid[i] = pt !== null && pt !== undefined && !isNaN(pt);
      pillTemps[i] = pillTempValid[i] ? pt : 0;
      const ct = d.controllerTemp;
      controllerTemps[i] = ct ?? 0;
      controllerValid[i] = ct !== null && ct !== undefined;
      const at = d.avgTemp;
      avgTemps[i] = at ?? 0;
      avgValid[i] = at !== null && at !== undefined;
    }
   
   // Use true sliding window - O(n) instead of O(n*windowSize)
   let valueSum = 0; let valueCount = 0;
   let pillTempSum = 0; let pillTempCount = 0;
    let controllerTempSum = 0;
    let controllerTempCount = 0;
    let avgTempSum = 0;
    let avgTempCount = 0;
    
    // Initialize window for first element
    const firstEnd = Math.min(len, halfWindow + 1);
    for (let j = 0; j < firstEnd; j++) {
      if (valueValid[j]) { valueSum += values[j]; valueCount++; }
      if (pillTempValid[j]) { pillTempSum += pillTemps[j]; pillTempCount++; }
      if (controllerValid[j]) {
        controllerTempSum += controllerTemps[j];
        controllerTempCount++;
      }
      if (avgValid[j]) {
        avgTempSum += avgTemps[j];
        avgTempCount++;
      }
    }
   
   for (let i = 0; i < len; i++) {
     // Add new element entering the window (right side)
     if (i > 0) {
       const newIdx = i + halfWindow;
         if (newIdx < len) {
          if (valueValid[newIdx]) { valueSum += values[newIdx]; valueCount++; }
          if (pillTempValid[newIdx]) { pillTempSum += pillTemps[newIdx]; pillTempCount++; }
          if (controllerValid[newIdx]) {
            controllerTempSum += controllerTemps[newIdx];
            controllerTempCount++;
          }
          if (avgValid[newIdx]) {
            avgTempSum += avgTemps[newIdx];
            avgTempCount++;
          }
        }
        
        // Remove element leaving the window (left side)
        const oldIdx = i - halfWindow - 1;
        if (oldIdx >= 0) {
          if (valueValid[oldIdx]) { valueSum -= values[oldIdx]; valueCount--; }
          if (pillTempValid[oldIdx]) { pillTempSum -= pillTemps[oldIdx]; pillTempCount--; }
          if (controllerValid[oldIdx]) {
            controllerTempSum -= controllerTemps[oldIdx];
            controllerTempCount--;
          }
          if (avgValid[oldIdx]) {
            avgTempSum -= avgTemps[oldIdx];
            avgTempCount--;
          }
        }
      }
      
       // Smooth targetTemp using median filter to remove spikes while preserving real step changes
       let smoothedTarget = data[i].targetTemp;
       if (smoothedTarget != null) {
         const medianWindow: number[] = [];
         const mHalf = Math.min(2, halfWindow); // smaller window for target to preserve steps
         for (let j = Math.max(0, i - mHalf); j <= Math.min(len - 1, i + mHalf); j++) {
           if (data[j].targetTemp != null) medianWindow.push(data[j].targetTemp!);
         }
         if (medianWindow.length >= 3) {
           medianWindow.sort((a, b) => a - b);
           smoothedTarget = medianWindow[Math.floor(medianWindow.length / 2)];
         }
       }

       result[i] = {
         ...data[i],
         // Store raw (unsmoothed) values for tooltip display
         rawValue: data[i].value,
         rawPillTemp: data[i].pillTemp,
         rawControllerTemp: data[i].controllerTemp,
         rawAvgTemp: data[i].avgTemp,
         // Store smoothed values for chart rendering
         value: valueValid[i] ? (valueCount > 0 ? valueSum / valueCount : data[i].value) : undefined as unknown as number,
         pillTemp: pillTempValid[i] ? (pillTempCount > 0 ? pillTempSum / pillTempCount : data[i].pillTemp) : undefined as unknown as number,
         controllerTemp: controllerTempCount > 0 ? controllerTempSum / controllerTempCount : null,
         avgTemp: avgTempCount > 0 ? avgTempSum / avgTempCount : null,
         targetTemp: smoothedTarget,
       };
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
