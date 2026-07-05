import { useSyncExternalStore, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface ChartSettingsState {
  smoothLines: boolean;
  timeRange: '12h' | 'full';
}

let state: ChartSettingsState = { smoothLines: true, timeRange: 'full' };
let listeners = new Set<() => void>();
let initialized = false;
let settingsId: string | null = null;
let channelSetup = false;

function notify() {
  listeners.forEach(l => l());
}

function setState(partial: Partial<ChartSettingsState>) {
  state = { ...state, ...partial };
  notify();
}

function persist(field: string, value: any) {
  if (!settingsId) return;
  supabase
    .from('sync_settings')
    .update({ [field]: value } as never)
    .eq('id', settingsId)
    .then(({ error }) => {
      if (error) console.error('[ChartSettings] Save failed:', error.message);
    });
}

function init() {
  if (initialized) return;
  initialized = true;

  supabase
    .from('sync_settings')
    .select('id, chart_smooth_lines, chart_time_range')
    .limit(1)
    .maybeSingle()
    .then(({ data }) => {
      if (data) {
        settingsId = data.id;
        setState({
          smoothLines: data.chart_smooth_lines ?? true,
          timeRange: (data.chart_time_range as '12h' | 'full') ?? 'full',
        });
      }
    });
}

function setupChannel() {
  if (channelSetup) return;
  channelSetup = true;

  supabase
    .channel('chart-settings-sync')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sync_settings' }, (payload: any) => {
      const d = payload.new;
      const partial: Partial<ChartSettingsState> = {};
      if (d?.chart_smooth_lines != null) partial.smoothLines = d.chart_smooth_lines;
      if (d?.chart_time_range) partial.timeRange = d.chart_time_range as '12h' | 'full';
      if (Object.keys(partial).length > 0) setState(partial);
    })
    .subscribe();
}

function getSnapshot(): ChartSettingsState {
  return state;
}

function subscribe(listener: () => void): () => void {
  init();
  setupChannel();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Syncs chart display settings (smooth lines, time range) via sync_settings table.
 * Singleton store — all components share the same state and one realtime subscription.
 */
export function useChartSettings() {
  const current = useSyncExternalStore(subscribe, getSnapshot);

  const setSmoothLines = useCallback((v: boolean) => {
    setState({ smoothLines: v });
    persist('chart_smooth_lines', v);
  }, []);

  const setTimeRange = useCallback((v: '12h' | 'full') => {
    setState({ timeRange: v });
    persist('chart_time_range', v);
  }, []);

  return {
    smoothLines: current.smoothLines,
    setSmoothLines,
    timeRange: current.timeRange,
    setTimeRange,
  };
}
