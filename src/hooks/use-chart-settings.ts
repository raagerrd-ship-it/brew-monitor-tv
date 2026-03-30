import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface ChartSettings {
  smoothLines: boolean;
  timeRange: '12h' | 'full';
}

/**
 * Syncs chart display settings (smooth lines, time range) via sync_settings table.
 * Changes propagate to all devices via Realtime.
 */
export function useChartSettings() {
  const [smoothLines, setSmoothLinesState] = useState(true);
  const [timeRange, setTimeRangeState] = useState<'12h' | 'full'>('full');
  const settingsIdRef = useRef<string | null>(null);
  const loadedRef = useRef(false);

  // Load initial values
  useEffect(() => {
    supabase
      .from('sync_settings')
      .select('id, chart_smooth_lines, chart_time_range')
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          settingsIdRef.current = data.id;
          setSmoothLinesState(data.chart_smooth_lines ?? true);
          setTimeRangeState((data.chart_time_range as '12h' | 'full') ?? 'full');
        }
        loadedRef.current = true;
      });
  }, []);

  // Listen for realtime changes from other devices
  useEffect(() => {
    const channel = supabase
      .channel('chart-settings-sync')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sync_settings' }, (payload: any) => {
        const d = payload.new;
        if (d?.chart_smooth_lines != null) setSmoothLinesState(d.chart_smooth_lines);
        if (d?.chart_time_range) setTimeRangeState(d.chart_time_range as '12h' | 'full');
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const persist = useCallback((field: string, value: any) => {
    if (!settingsIdRef.current) return;
    supabase
      .from('sync_settings')
      .update({ [field]: value })
      .eq('id', settingsIdRef.current)
      .then(({ error }) => {
        if (error) console.error('[ChartSettings] Save failed:', error.message);
      });
  }, []);

  const setSmoothLines = useCallback((v: boolean) => {
    setSmoothLinesState(v);
    persist('chart_smooth_lines', v);
  }, [persist]);

  const setTimeRange = useCallback((v: '12h' | 'full') => {
    setTimeRangeState(v);
    persist('chart_time_range', v);
  }, [persist]);

  return { smoothLines, setSmoothLines, timeRange, setTimeRange };
}
