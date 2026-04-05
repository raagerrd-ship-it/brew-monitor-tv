import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';
import type { TimeRange } from './useControllerTempData';

export interface MultiChartDataPoint {
  time: string;
  timestamp: number;
  [key: string]: string | number | null; // dynamic keys: {id}_cooling, {id}_actual, {id}_probe, {id}_target, {id}_profile
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
  tempDomain: [number, number];
}

export function useMultiControllerTempData({ controllers }: UseMultiControllerTempDataProps): UseMultiControllerTempDataReturn {
  const [data, setData] = useState<MultiChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRange>('3h');
  const [tempDomain, setTempDomain] = useState<[number, number]>([0, 30]);

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

      const { data: history, error } = await supabase
        .from('temp_controller_history')
        .select('controller_id, recorded_at, duty_pct, cooling_enabled, current_temp, target_temp, actual_temp, profile_target_temp')
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

      // Place values into 5-min buckets
      const bucketSizeMs = 5 * 60 * 1000;
      const bucketMap = new Map<number, MultiChartDataPoint>();
      let allMinTemp = Infinity;
      let allMaxTemp = -Infinity;

      for (const record of history) {
        const ts = new Date(record.recorded_at).getTime();
        const bucketTs = Math.floor(ts / bucketSizeMs) * bucketSizeMs;

        if (!bucketMap.has(bucketTs)) {
          bucketMap.set(bucketTs, {
            time: format(new Date(bucketTs), 'HH:mm', { locale: sv }),
            timestamp: bucketTs,
          });
        }
        const point = bucketMap.get(bucketTs)!;
        const id = record.controller_id;

        // Duty: split into cooling vs heating based on cooling_enabled
        if (record.duty_pct != null) {
          const value = parseFloat(String(record.duty_pct));
          const isCooling = record.cooling_enabled;
          const coolingKey = `${id}_cooling`;
          const heatingKey = `${id}_heating`;
          if (isCooling) {
            const existing = point[coolingKey] as number | undefined;
            point[coolingKey] = existing != null ? Math.max(existing, value) : value;
          } else {
            const existing = point[heatingKey] as number | undefined;
            point[heatingKey] = existing != null ? Math.max(existing, value) : value;
          }
        }

        // Temps: use last value in bucket (overwrite)
        const round1 = (v: number | null) => v != null ? Math.round(parseFloat(String(v)) * 10) / 10 : null;

        const probeVal = round1(record.current_temp);
        const targetVal = round1(record.target_temp);
        const actualVal = round1(record.actual_temp);
        const profileVal = round1(record.profile_target_temp);

        if (probeVal != null) { point[`${id}_probe`] = probeVal; allMinTemp = Math.min(allMinTemp, probeVal); allMaxTemp = Math.max(allMaxTemp, probeVal); }
        if (targetVal != null) { point[`${id}_target`] = targetVal; allMinTemp = Math.min(allMinTemp, targetVal); allMaxTemp = Math.max(allMaxTemp, targetVal); }
        if (actualVal != null) { point[`${id}_actual`] = actualVal; allMinTemp = Math.min(allMinTemp, actualVal); allMaxTemp = Math.max(allMaxTemp, actualVal); }
        if (profileVal != null) { point[`${id}_profile`] = profileVal; allMinTemp = Math.min(allMinTemp, profileVal); allMaxTemp = Math.max(allMaxTemp, profileVal); }
      }

      const merged = Array.from(bucketMap.values()).sort((a, b) => a.timestamp - b.timestamp);
      setData(merged);
      const rawRange = (allMaxTemp - allMinTemp) || 1;
      const pad = rawRange * 0.05;
      setTempDomain([
        allMinTemp === Infinity ? 0 : Math.floor((allMinTemp - pad) * 10) / 10,
        allMaxTemp === -Infinity ? 30 : Math.ceil((allMaxTemp + pad) * 10) / 10,
      ]);
      setLoading(false);
    };

    fetchAll();
  }, [controllers, timeRange]);

  return { data, loading, timeRange, setTimeRange, tempDomain };
}