import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';

export type TimeRange = '3h' | '24h';

interface SampledRecord {
  recorded_at: string;
  current_temp: number;
  target_temp: number;
  cooling_enabled: boolean;
  cooling_ratio: number | null;
  actual_temp: number | null;
  profile_target_temp: number | null;
}

export interface ChartDataPoint {
  time: string;
  timestamp: number;
  currentTemp: number;
  targetTemp: number;
  coolingPercent: number;
  actualTemp: number | null;
  profileTargetTemp: number | null;
}

interface UseControllerTempDataProps {
  controllerId: string;
}

interface UseControllerTempDataReturn {
  data: ChartDataPoint[];
  loading: boolean;
  timeRange: TimeRange;
  setTimeRange: (range: TimeRange) => void;
  minTemp: number;
  maxTemp: number;
}

export function useControllerTempData({ controllerId }: UseControllerTempDataProps): UseControllerTempDataReturn {
  const [data, setData] = useState<ChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRange>('3h');

  useEffect(() => {
    const fetchHistory = async () => {
      setLoading(true);
      
      // Calculate time range
      const now = new Date();
      const hoursAgo = timeRange === '3h' ? 3 : 24;
      const startTime = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);
      
      // Use different sample intervals: 1 min for 3h, 5 min for 24h
      const sampleInterval = timeRange === '3h' ? 1 : 5;
      
      const { data: history, error } = await supabase
        .rpc('get_temp_history_sampled', {
          p_controller_id: controllerId,
          p_start_time: startTime.toISOString(),
          p_end_time: now.toISOString(),
          p_sample_interval_minutes: sampleInterval
        });

      if (error) {
        console.error('Error fetching temperature history:', error);
        setLoading(false);
        return;
      }

      if (!history || history.length === 0) {
        setData([]);
        setLoading(false);
        return;
      }

      const chartData: ChartDataPoint[] = history.map((record: SampledRecord) => ({
        time: format(new Date(record.recorded_at), timeRange === '3h' ? 'HH:mm' : 'HH:mm', { locale: sv }),
        timestamp: new Date(record.recorded_at).getTime(),
        currentTemp: Math.round(Number(record.current_temp) * 10) / 10,
        targetTemp: Math.round(Number(record.target_temp) * 10) / 10,
        coolingPercent: Math.round((Number(record.cooling_ratio ?? 0)) * 100),
        actualTemp: record.actual_temp != null ? Math.round(Number(record.actual_temp) * 10) / 10 : null,
        profileTargetTemp: record.profile_target_temp != null ? Math.round(Number(record.profile_target_temp) * 10) / 10 : null,
      }));

      setData(chartData);
      setLoading(false);
    };

    fetchHistory();
  }, [controllerId, timeRange]);

  // Calculate min/max for Y axis with some padding
  const temps = data.length > 0 ? data.flatMap(d => [d.currentTemp, d.targetTemp, ...(d.actualTemp != null ? [d.actualTemp] : []), ...(d.profileTargetTemp != null ? [d.profileTargetTemp] : [])]) : [0];
  const minTemp = Math.floor(Math.min(...temps)) - 1;
  const maxTemp = Math.ceil(Math.max(...temps)) + 1;

  return {
    data,
    loading,
    timeRange,
    setTimeRange,
    minTemp,
    maxTemp,
  };
}
