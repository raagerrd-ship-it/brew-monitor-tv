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

  subscribeSyncSettings((d) => {
    settingsId = d.id ?? settingsId;
    const partial: Partial<ChartSettingsState> = {};
    if (d.chart_smooth_lines != null && d.chart_smooth_lines !== state.smoothLines) partial.smoothLines = d.chart_smooth_lines;
    if (d.chart_time_range && d.chart_time_range !== state.timeRange) partial.timeRange = d.chart_time_range as '12h' | 'full';
    if (Object.keys(partial).length > 0) setState(partial);
  });
}

function getSnapshot(): ChartSettingsState {
  return state;
}

function subscribe(listener: () => void): () => void {
  init();
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
