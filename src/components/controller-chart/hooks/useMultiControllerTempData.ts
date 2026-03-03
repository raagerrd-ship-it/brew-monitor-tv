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

      // Fetch cooling_enabled history from temp_controller_history for all controllers
      const { data: history, error } = await supabase
        .from('temp_controller_history')
        .select('controller_id, recorded_at, cooling_enabled')
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

      // Group records into time buckets (5-min windows) and calculate % of cooling_enabled=true
      const bucketSizeMs = 5 * 60 * 1000; // 5 minutes
      const bucketMap = new Map<number, MultiChartDataPoint>();
      // Track counts per bucket per controller: { true: n, total: n }
      const countsMap = new Map<string, { on: number; total: number }>();

      for (const record of history) {
        const ts = new Date(record.recorded_at).getTime();
        const bucketTs = Math.floor(ts / bucketSizeMs) * bucketSizeMs;
        const key = `${bucketTs}_${record.controller_id}`;

        if (!countsMap.has(key)) {
          countsMap.set(key, { on: 0, total: 0 });
        }
        const counts = countsMap.get(key)!;
        counts.total++;
        if (record.cooling_enabled) counts.on++;

        if (!bucketMap.has(bucketTs)) {
          bucketMap.set(bucketTs, {
            time: format(new Date(bucketTs), 'HH:mm', { locale: sv }),
            timestamp: bucketTs,
          });
        }
      }

      // Calculate percentages
      for (const [key, counts] of countsMap) {
        const [bucketTsStr, controllerId] = [key.substring(0, key.indexOf('_')), key.substring(key.indexOf('_') + 1)];
        const bucketTs = parseInt(bucketTsStr);
        const point = bucketMap.get(bucketTs);
        if (point) {
          point[`${controllerId}_cooling`] = Math.round((counts.on / counts.total) * 100);
        }
      }

      const merged = Array.from(bucketMap.values()).sort((a, b) => a.timestamp - b.timestamp);
      setData(merged);
      setLoading(false);
    };

    fetchAll();
  }, [controllers, timeRange]);

  return { data, loading, timeRange, setTimeRange };
}
