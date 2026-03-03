import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';
import type { TimeRange } from './useControllerTempData';

export interface MultiChartDataPoint {
  time: string;
  timestamp: number;
  [key: string]: string | number; // dynamic keys: {id}_current, {id}_target, {id}_cooling
}

interface ControllerInfo {
  id: string;
  name: string;
  color: string;
  isGlycolCooler?: boolean;
}

interface UseMultiControllerTempDataProps {
  controllers: ControllerInfo[];
}

interface UseMultiControllerTempDataReturn {
  data: MultiChartDataPoint[];
  loading: boolean;
  timeRange: TimeRange;
  setTimeRange: (range: TimeRange) => void;
  minTemp: number;
  maxTemp: number;
}

export function useMultiControllerTempData({ controllers }: UseMultiControllerTempDataProps): UseMultiControllerTempDataReturn {
  const [data, setData] = useState<MultiChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');

  useEffect(() => {
    if (controllers.length === 0) {
      setData([]);
      setLoading(false);
      return;
    }

    const fetchAll = async () => {
      setLoading(true);

      const now = new Date();
      const hoursAgo = timeRange === '24h' ? 24 : 24 * 7;
      const startTime = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);
      const sampleInterval = timeRange === '24h' ? 5 : 30;

      const results = await Promise.all(
        controllers.map(async (ctrl) => {
          const { data: history } = await supabase.rpc('get_temp_history_sampled', {
            p_controller_id: ctrl.id,
            p_start_time: startTime.toISOString(),
            p_end_time: now.toISOString(),
            p_sample_interval_minutes: sampleInterval,
          });
          return { id: ctrl.id, history: history ?? [] };
        })
      );

      // Merge by timestamp bucket
      const bucketMap = new Map<number, MultiChartDataPoint>();

      for (const { id, history } of results) {
        for (const record of history) {
          const ts = new Date(record.recorded_at).getTime();
          if (!bucketMap.has(ts)) {
            bucketMap.set(ts, {
              time: format(new Date(record.recorded_at), timeRange === '24h' ? 'HH:mm' : 'dd/MM HH:mm', { locale: sv }),
              timestamp: ts,
            });
          }
          const point = bucketMap.get(ts)!;
          point[`${id}_current`] = Number(record.current_temp);
          point[`${id}_target`] = Number(record.target_temp);
          point[`${id}_cooling`] = Math.round(Number(record.cooling_ratio ?? 0) * 100);
        }
      }

      const merged = Array.from(bucketMap.values()).sort((a, b) => a.timestamp - b.timestamp);
      setData(merged);
      setLoading(false);
    };

    fetchAll();
  }, [controllers, timeRange]);

  // Calculate min/max across all controllers
  const temps: number[] = [];
  for (const point of data) {
    for (const key of Object.keys(point)) {
      if (key.endsWith('_current') || key.endsWith('_target')) {
        temps.push(point[key] as number);
      }
    }
  }
  const minTemp = temps.length > 0 ? Math.floor(Math.min(...temps)) - 1 : 0;
  const maxTemp = temps.length > 0 ? Math.ceil(Math.max(...temps)) + 1 : 30;

  return { data, loading, timeRange, setTimeRange, minTemp, maxTemp };
}
