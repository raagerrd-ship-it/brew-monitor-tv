import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';
import type { TimeRange } from './useControllerTempData';

export interface MultiChartDataPoint {
  time: string;
  timestamp: number;
  [key: string]: string | number; // dynamic keys: {id}_cooling
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
}

export function useMultiControllerTempData({ controllers }: UseMultiControllerTempDataProps): UseMultiControllerTempDataReturn {
  const [data, setData] = useState<MultiChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRange>('3h');

  useEffect(() => {
    if (controllers.length === 0) {
      setData([]);
      setLoading(false);
      return;
    }

    const fetchAll = async () => {
      setLoading(true);

      const now = new Date();
      const hoursAgo = timeRange === '3h' ? 3 : 24;
      const startTime = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);

      // Fetch duty_pct directly from temp_controller_history
      const { data: history, error } = await supabase
        .from('temp_controller_history')
        .select('controller_id, recorded_at, duty_pct')
        .gte('recorded_at', startTime.toISOString())
        .lte('recorded_at', now.toISOString())
        .in('controller_id', controllers.map(c => c.id))
        .order('recorded_at', { ascending: true });

      if (error || !history) {
        console.error('Error fetching temp controller history:', error);
        setData([]);
        setLoading(false);
        return;
      }

      // Place duty_pct values into 5-min buckets
      const bucketSizeMs = 5 * 60 * 1000;
      const bucketMap = new Map<number, MultiChartDataPoint>();

      for (const record of history) {
        const dutyPct = record.duty_pct;
        if (dutyPct == null) continue;

        const ts = new Date(record.recorded_at).getTime();
        const bucketTs = Math.floor(ts / bucketSizeMs) * bucketSizeMs;

        if (!bucketMap.has(bucketTs)) {
          bucketMap.set(bucketTs, {
            time: format(new Date(bucketTs), 'HH:mm', { locale: sv }),
            timestamp: bucketTs,
          });
        }
        const point = bucketMap.get(bucketTs)!;

        const key = `${record.controller_id}_cooling`;
        const existing = point[key] as number | undefined;
        const value = parseFloat(String(dutyPct));
        point[key] = existing != null ? Math.max(existing, value) : value;
      }

      const merged = Array.from(bucketMap.values()).sort((a, b) => a.timestamp - b.timestamp);
      setData(merged);
      setLoading(false);
    };

    fetchAll();
  }, [controllers, timeRange]);

  return { data, loading, timeRange, setTimeRange };
}
