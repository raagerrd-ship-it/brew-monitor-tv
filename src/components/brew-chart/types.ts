export interface ChartDataPoint {
  date: string;
  value: number;
  temp: number;
}

export interface ChartDataPointWithTimestamp extends ChartDataPoint {
  timestamp: number;
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
}

export interface EventDisplay {
  label: string;
  color: string;
}
