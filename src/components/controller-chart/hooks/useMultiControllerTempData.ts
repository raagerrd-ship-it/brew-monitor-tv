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

      // Fetch actual utilization from cooler_margin_history
      const { data: marginHistory, error } = await supabase
        .from('cooler_margin_history')
        .select('controller_id, recorded_at, utilization')
        .gte('recorded_at', startTime.toISOString())
        .lte('recorded_at', now.toISOString())
        .in('controller_id', controllers.map(c => c.id))
        .order('recorded_at', { ascending: true });

      if (error || !marginHistory) {
        console.error('Error fetching cooler margin history:', error);
        setData([]);
        setLoading(false);
        return;
      }

      // Build timeline from margin history records
      const bucketMap = new Map<number, MultiChartDataPoint>();

      for (const record of marginHistory) {
        const ts = new Date(record.recorded_at).getTime();
        // Round to nearest minute for grouping
        const roundedTs = Math.round(ts / 60000) * 60000;
        
        if (!bucketMap.has(roundedTs)) {
          bucketMap.set(roundedTs, {
            time: format(new Date(roundedTs), 'HH:mm', { locale: sv }),
            timestamp: roundedTs,
          });
        }
        const point = bucketMap.get(roundedTs)!;
        point[`${record.controller_id}_cooling`] = Math.round((record.utilization ?? 0) * 100);
      }

      const merged = Array.from(bucketMap.values()).sort((a, b) => a.timestamp - b.timestamp);
      setData(merged);
      setLoading(false);
    };

    fetchAll();
  }, [controllers, timeRange]);

  return { data, loading, timeRange, setTimeRange };
}
