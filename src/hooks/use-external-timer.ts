import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface TimerMilestone {
  time: number;
  atSeconds?: number;
  label: string;
  triggered?: boolean;
  acknowledged?: boolean;
  pauseForTemperature?: boolean;
  targetTemperature?: number;
  whirlpoolTime?: number;
}

export interface NextConfig {
  label: string;
  minutes: number;
  navigateTo?: string;
}

export interface ExternalTimerState {
  isActive: boolean;
  label: string;
  remainingSeconds: number;
  totalSeconds: number;
  isPaused: boolean;
  pausedByMilestone: boolean;
  pausedAt: string | null;
  milestones: TimerMilestone[];
  nextMilestone: TimerMilestone | null;
  timeToNextMilestone: number | null;
  progress: number;
  nextConfig: NextConfig | null;
  wizardStep: string | null;
  recipeName: string | null;
  beerStyle: string | null;
}

const initialState: ExternalTimerState = {
  isActive: false,
  label: '',
  remainingSeconds: 0,
  totalSeconds: 0,
  isPaused: false,
  pausedByMilestone: false,
  pausedAt: null,
  milestones: [],
  nextMilestone: null,
  timeToNextMilestone: null,
  progress: 0,
  nextConfig: null,
  wizardStep: null,
  recipeName: null,
  beerStyle: null,
};

// Interval constants
const FAST_SYNC_MS = 3_000;
const FAST_POLL_MS = 5_000;
const SLOW_POLL_MS = 60_000;

export function useExternalTimer() {
  const [timerState, setTimerState] = useState<ExternalTimerState>(initialState);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isActiveRef = useRef(false); // Track active state for interval switching
  const timerDataRef = useRef<{
    startedAt: string | null;
    remainingAtStart: number;
    totalSeconds: number;
    isPaused: boolean;
    milestones: TimerMilestone[];
    nextMilestone: TimerMilestone | null;
    timeToNextMilestoneAtStart: number | null;
  } | null>(null);

  const calculateRemainingSeconds = useCallback(() => {
    const data = timerDataRef.current;
    if (!data || !data.startedAt) return 0;
    if (data.isPaused) return data.remainingAtStart;
    const startedAt = new Date(data.startedAt).getTime();
    const now = Date.now();
    const elapsed = Math.floor((now - startedAt) / 1000);
    return Math.max(0, data.remainingAtStart - elapsed);
  }, []);

  const calculateNextMilestone = useCallback((remainingSeconds: number): TimerMilestone | null => {
    const data = timerDataRef.current;
    if (!data || !data.milestones.length) return null;
    const sortedMilestones = [...data.milestones].sort((a, b) => a.time - b.time);
    const upcomingMilestones = sortedMilestones.filter(m => m.time < remainingSeconds && !m.triggered);
    return upcomingMilestones.length > 0 ? upcomingMilestones[upcomingMilestones.length - 1] : null;
  }, []);

  const calculateTimeToNextMilestone = useCallback((remainingSeconds: number, nextMilestone: TimerMilestone | null): number | null => {
    if (!nextMilestone) return null;
    return Math.max(0, remainingSeconds - nextMilestone.time);
  }, []);

  const updateTimerState = useCallback(() => {
    const data = timerDataRef.current;
    if (!data) {
      setTimerState(initialState);
      return;
    }
    const remainingSeconds = calculateRemainingSeconds();
    const nextMilestone = calculateNextMilestone(remainingSeconds);
    const timeToNextMilestone = calculateTimeToNextMilestone(remainingSeconds, nextMilestone);
    const progress = data.totalSeconds > 0 ? ((data.totalSeconds - remainingSeconds) / data.totalSeconds) * 100 : 0;
    setTimerState(prev => ({
      ...prev,
      remainingSeconds,
      nextMilestone,
      timeToNextMilestone,
      progress: Math.min(100, Math.max(0, progress)),
    }));
  }, [calculateRemainingSeconds, calculateNextMilestone, calculateTimeToNextMilestone]);

  const parseMilestone = useCallback((m: unknown): TimerMilestone => {
    const milestone = m as Record<string, unknown>;
    return {
      time: typeof milestone.time === 'number' ? milestone.time : 0,
      atSeconds: typeof milestone.atSeconds === 'number' ? milestone.atSeconds : undefined,
      label: typeof milestone.label === 'string' ? milestone.label : '',
      triggered: typeof milestone.triggered === 'boolean' ? milestone.triggered : undefined,
      acknowledged: typeof milestone.acknowledged === 'boolean' ? milestone.acknowledged : undefined,
      pauseForTemperature: typeof milestone.pauseForTemperature === 'boolean' ? milestone.pauseForTemperature : undefined,
      targetTemperature: typeof milestone.targetTemperature === 'number' ? milestone.targetTemperature : undefined,
      whirlpoolTime: typeof milestone.whirlpoolTime === 'number' ? milestone.whirlpoolTime : undefined,
    };
  }, []);

  const parseNextConfig = useCallback((raw: unknown): NextConfig | null => {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    return {
      label: typeof obj.label === 'string' ? obj.label : '',
      minutes: typeof obj.minutes === 'number' ? obj.minutes : 0,
      navigateTo: typeof obj.navigateTo === 'string' ? obj.navigateTo : undefined,
    };
  }, []);

  const fetchFromCache = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('cached_external_timer')
        .select('*')
        .order('last_synced_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Error fetching cached timer:', error);
        return;
      }

      if (!data) {
        timerDataRef.current = null;
        isActiveRef.current = false;
        setTimerState(initialState);
        return;
      }

      const rawMilestones = Array.isArray(data.milestones) ? data.milestones : [];
      const milestones: TimerMilestone[] = rawMilestones.map(parseMilestone);

      const lastSynced = new Date(data.last_synced_at).getTime();
      const now = Date.now();
      const elapsedSinceSync = Math.floor((now - lastSynced) / 1000);
      
      const adjustedRemaining = data.is_paused 
        ? data.remaining_seconds 
        : Math.max(0, data.remaining_seconds - elapsedSinceSync);
      
      const adjustedTimeToNext = data.is_paused || data.time_to_next_milestone === null
        ? data.time_to_next_milestone
        : Math.max(0, data.time_to_next_milestone - elapsedSinceSync);

      const nextMilestone: TimerMilestone | null = data.next_milestone 
        ? parseMilestone(data.next_milestone)
        : null;

      const nextConfig = parseNextConfig((data as Record<string, unknown>).next_config);

      // Drift-aware update: only reset the countdown base if there's significant drift (>3s)
      // or if the pause/active state changed. This prevents the 1-2 second flicker
      // caused by network latency on each sync.
      const prev = timerDataRef.current;
      const stateChanged = !prev || 
        prev.isPaused !== data.is_paused || 
        prev.totalSeconds !== data.total_seconds;
      
      if (stateChanged) {
        // State changed — full reset
        timerDataRef.current = {
          startedAt: new Date().toISOString(),
          remainingAtStart: adjustedRemaining,
          totalSeconds: data.total_seconds,
          isPaused: data.is_paused,
          milestones,
          nextMilestone,
          timeToNextMilestoneAtStart: adjustedTimeToNext,
        };
      } else {
        // Same state — check drift before resetting
        const localRemaining = calculateRemainingSeconds();
        const drift = Math.abs(localRemaining - adjustedRemaining);
        
        if (drift > 3) {
          // Significant drift, correct it
          timerDataRef.current = {
            startedAt: new Date().toISOString(),
            remainingAtStart: adjustedRemaining,
            totalSeconds: data.total_seconds,
            isPaused: data.is_paused,
            milestones,
            nextMilestone,
            timeToNextMilestoneAtStart: adjustedTimeToNext,
          };
        } else {
          // Small drift — only update milestones/metadata, keep countdown base stable
          timerDataRef.current = {
            ...prev,
            milestones,
            nextMilestone,
            timeToNextMilestoneAtStart: adjustedTimeToNext,
          };
        }
      }

      if (!data.is_active) {
        isActiveRef.current = false;
        setTimerState(initialState);
        return;
      }

      isActiveRef.current = true;

      const apiProgress = typeof data.progress === 'number' ? data.progress : 0;
      const currentRemaining = calculateRemainingSeconds();
      const localProgress = data.total_seconds > 0 
        ? ((data.total_seconds - currentRemaining) / data.total_seconds) * 100 
        : apiProgress;

      setTimerState({
        isActive: data.is_active && currentRemaining > 0,
        label: data.label || '',
        remainingSeconds: currentRemaining,
        totalSeconds: data.total_seconds,
        isPaused: data.is_paused,
        pausedByMilestone: data.paused_by_milestone,
        pausedAt: data.paused_at ?? null,
        milestones,
        nextMilestone,
        timeToNextMilestone: adjustedTimeToNext,
        progress: Math.min(100, Math.max(0, localProgress)),
        nextConfig,
        wizardStep: data.wizard_step ?? null,
        recipeName: data.recipe_name ?? null,
        beerStyle: data.beer_style ?? null,
      });
    } catch (error) {
      console.error('Error fetching cached timer:', error);
    }
  }, [parseMilestone, parseNextConfig, calculateRemainingSeconds]);

  const triggerSync = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-external-timer`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
        }
      );
      clearTimeout(timeout);
    } catch {
      // Ignore — cron fallback will handle it
    }
  }, []);

  // Helper to set up sync/poll intervals based on active state
  const setupIntervals = useCallback((active: boolean) => {
    // Clear existing
    if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    syncIntervalRef.current = null;

    // Only sync edge function when timer is active
    if (active) {
      syncIntervalRef.current = setInterval(() => triggerSync(), FAST_SYNC_MS);
    }

    const pollMs = active ? FAST_POLL_MS : SLOW_POLL_MS;
    pollIntervalRef.current = setInterval(() => fetchFromCache(), pollMs);
  }, [triggerSync, fetchFromCache]);

  // Initial fetch, subscribe, and set up intervals
  useEffect(() => {
    fetchFromCache();
    triggerSync();

    // Start with slow intervals; fetchFromCache will update isActiveRef
    setupIntervals(false);

    // Realtime subscription for instant updates when cache changes
    const channel = supabase
      .channel('external-timer-realtime')
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'cached_external_timer' }, () => {
        fetchFromCache();
      })
      .subscribe();

    return () => {
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      supabase.removeChannel(channel);
    };
  }, [fetchFromCache, triggerSync, setupIntervals]);

  // Switch intervals when active state changes
  useEffect(() => {
    setupIntervals(timerState.isActive);
  }, [timerState.isActive, setupIntervals]);

  // Update remaining seconds every second when timer is active and not paused
  useEffect(() => {
    const shouldCount = timerState.isActive && !timerState.isPaused && !timerState.pausedByMilestone;
    
    if (shouldCount) {
      intervalRef.current = setInterval(() => {
        updateTimerState();
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [timerState.isActive, timerState.isPaused, timerState.pausedByMilestone, updateTimerState]);

  return timerState;
}
