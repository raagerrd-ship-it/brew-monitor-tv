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

      // Fetch temp history with cooling_run_time for all controllers
      const { data: history, error } = await supabase
        .from('temp_controller_history')
        .select('controller_id, recorded_at, cooling_run_time')
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

      // Group snapshots per controller in time order
      const perController = new Map<string, Array<{ ts: number; runTime: number }>>();
      for (const record of history) {
        const rt = record.cooling_run_time;
        if (rt == null) continue; // skip rows without cooling_run_time
        const controllerId = record.controller_id;
        if (!perController.has(controllerId)) {
          perController.set(controllerId, []);
        }
        perController.get(controllerId)!.push({
          ts: new Date(record.recorded_at).getTime(),
          runTime: parseFloat(String(rt)),
        });
      }

      // For each controller, calculate utilization between consecutive snapshots
      // and assign to 5-min buckets
      const bucketSizeMs = 5 * 60 * 1000;
      const bucketMap = new Map<number, MultiChartDataPoint>();

      for (const [controllerId, snapshots] of perController) {
        for (let i = 1; i < snapshots.length; i++) {
          const prev = snapshots[i - 1];
          const curr = snapshots[i];
          const elapsedMs = curr.ts - prev.ts;
          if (elapsedMs <= 0) continue;

          const deltaRunTime = curr.runTime - prev.runTime;
          // If counter reset or went backwards, skip
          if (deltaRunTime < 0) continue;

          const elapsedSec = elapsedMs / 1000;
          const utilization = Math.min(1.0, deltaRunTime / elapsedSec);
          const utilPercent = Math.round(utilization * 100);

          // Place at the bucket of the current snapshot
          const bucketTs = Math.floor(curr.ts / bucketSizeMs) * bucketSizeMs;

          if (!bucketMap.has(bucketTs)) {
            bucketMap.set(bucketTs, {
              time: format(new Date(bucketTs), 'HH:mm', { locale: sv }),
              timestamp: bucketTs,
            });
          }
          const point = bucketMap.get(bucketTs)!;

          // If multiple intervals fall in same bucket, use max
          const key = `${controllerId}_cooling`;
          const existing = point[key] as number | undefined;
          point[key] = existing != null ? Math.max(existing, utilPercent) : utilPercent;
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
