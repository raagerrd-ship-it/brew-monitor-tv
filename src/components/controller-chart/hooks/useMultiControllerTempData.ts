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

      // Fetch controller hysteresis values for relay inference
      const { data: controllerInfo } = await supabase
        .from('rapt_temp_controllers')
        .select('controller_id, cooling_hysteresis')
        .in('controller_id', controllers.map(c => c.id));

      const hysteresisMap = new Map<string, number>();
      for (const c of controllerInfo ?? []) {
        hysteresisMap.set(c.controller_id, parseFloat(String(c.cooling_hysteresis ?? 0.2)));
      }

      // Fetch temp history for all controllers
      const { data: history, error } = await supabase
        .from('temp_controller_history')
        .select('controller_id, recorded_at, current_temp, target_temp, cooling_enabled')
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

      // Group into 5-min buckets, infer relay state from temp vs target+hysteresis
      const bucketSizeMs = 5 * 60 * 1000;
      const bucketMap = new Map<number, MultiChartDataPoint>();
      const countsMap = new Map<string, { on: number; total: number }>();

      for (const record of history) {
        if (!record.cooling_enabled) {
          // Cooling mode disabled on this controller — relay definitely off
          continue;
        }

        const ts = new Date(record.recorded_at).getTime();
        const bucketTs = Math.floor(ts / bucketSizeMs) * bucketSizeMs;
        const key = `${bucketTs}_${record.controller_id}`;

        if (!countsMap.has(key)) {
          countsMap.set(key, { on: 0, total: 0 });
        }
        const counts = countsMap.get(key)!;
        counts.total++;

        // Infer relay state: relay is ON when current_temp > target_temp + hysteresis
        // (RAPT turns relay ON at target+hysteresis, OFF at target)
        const hysteresis = hysteresisMap.get(record.controller_id) ?? 0.2;
        const currentTemp = parseFloat(String(record.current_temp));
        const targetTemp = parseFloat(String(record.target_temp));
        const relayOn = currentTemp > targetTemp;
        
        if (relayOn) counts.on++;

        if (!bucketMap.has(bucketTs)) {
          bucketMap.set(bucketTs, {
            time: format(new Date(bucketTs), 'HH:mm', { locale: sv }),
            timestamp: bucketTs,
          });
        }
      }

      // Calculate percentages
      for (const [key, counts] of countsMap) {
        const sepIdx = key.indexOf('_');
        const bucketTs = parseInt(key.substring(0, sepIdx));
        const controllerId = key.substring(sepIdx + 1);
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
