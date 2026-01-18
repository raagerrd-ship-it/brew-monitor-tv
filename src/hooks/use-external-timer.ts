import { useState, useEffect, useCallback, useRef } from 'react';
import { externalSupabase } from '@/integrations/external-supabase/client';
import { supabase } from '@/integrations/supabase/client';
import { useExternalAuth } from '@/contexts/ExternalAuthContext';

export interface TimerMilestone {
  time: number;
  label: string;
  triggered?: boolean;
}

export interface ExternalTimerState {
  isActive: boolean;
  label: string;
  remainingSeconds: number;
  totalSeconds: number;
  isPaused: boolean;
  pausedByMilestone: boolean;
  milestones: TimerMilestone[];
  nextMilestone: TimerMilestone | null;
  timeToNextMilestone: number | null;
  progress: number;
}

const initialState: ExternalTimerState = {
  isActive: false,
  label: '',
  remainingSeconds: 0,
  totalSeconds: 0,
  isPaused: false,
  pausedByMilestone: false,
  milestones: [],
  nextMilestone: null,
  timeToNextMilestone: null,
  progress: 0,
};

export function useExternalTimer() {
  const { user, session, isAuthenticated } = useExternalAuth();
  const [timerState, setTimerState] = useState<ExternalTimerState>(initialState);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
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

    if (data.isPaused) {
      return data.remainingAtStart;
    }

    const startedAt = new Date(data.startedAt).getTime();
    const now = Date.now();
    const elapsed = Math.floor((now - startedAt) / 1000);
    const remaining = Math.max(0, data.remainingAtStart - elapsed);
    return remaining;
  }, []);

  const calculateTimeToNextMilestone = useCallback(() => {
    const data = timerDataRef.current;
    if (!data || data.timeToNextMilestoneAtStart === null) return null;

    if (data.isPaused) {
      return data.timeToNextMilestoneAtStart;
    }

    const startedAt = new Date(data.startedAt!).getTime();
    const now = Date.now();
    const elapsed = Math.floor((now - startedAt) / 1000);
    const remaining = Math.max(0, data.timeToNextMilestoneAtStart - elapsed);
    return remaining;
  }, []);

  const updateTimerState = useCallback(() => {
    const data = timerDataRef.current;
    if (!data) {
      setTimerState(initialState);
      return;
    }

    const remainingSeconds = calculateRemainingSeconds();
    const timeToNextMilestone = calculateTimeToNextMilestone();
    const progress = data.totalSeconds > 0 ? 1 - (remainingSeconds / data.totalSeconds) : 0;

    setTimerState(prev => ({
      ...prev,
      remainingSeconds,
      nextMilestone: data.nextMilestone,
      timeToNextMilestone,
      progress: Math.min(1, Math.max(0, progress)),
    }));
  }, [calculateRemainingSeconds, calculateTimeToNextMilestone]);

  // Save timer data to local cache for public access
  const cacheTimerData = useCallback(async (data: ExternalTimerState & { externalUserId: string }) => {
    try {
      // First check if record exists
      const { data: existing } = await supabase
        .from('cached_external_timer')
        .select('id')
        .eq('external_user_id', data.externalUserId)
        .maybeSingle();

      const timerRecord = {
        is_active: data.isActive,
        label: data.label,
        remaining_seconds: data.remainingSeconds,
        total_seconds: data.totalSeconds,
        is_paused: data.isPaused,
        paused_by_milestone: data.pausedByMilestone,
        milestones: JSON.parse(JSON.stringify(data.milestones)),
        next_milestone: data.nextMilestone ? JSON.parse(JSON.stringify(data.nextMilestone)) : null,
        time_to_next_milestone: data.timeToNextMilestone,
        progress: data.progress,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (existing) {
        await supabase
          .from('cached_external_timer')
          .update(timerRecord)
          .eq('external_user_id', data.externalUserId);
      } else {
        await supabase
          .from('cached_external_timer')
          .insert([{
            external_user_id: data.externalUserId,
            ...timerRecord,
          }]);
      }
    } catch (error) {
      console.error('Error caching timer data:', error);
    }
  }, []);

  // Fetch from local cache (for non-authenticated users)
  const fetchFromCache = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('cached_external_timer')
        .select('*')
        .eq('is_active', true)
        .order('last_synced_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Error fetching cached timer:', error);
        return;
      }

      if (!data) {
        timerDataRef.current = null;
        setTimerState(initialState);
        return;
      }

      const rawMilestones = Array.isArray(data.milestones) ? data.milestones : [];
      const milestones: TimerMilestone[] = rawMilestones.map((m: unknown) => {
        const milestone = m as Record<string, unknown>;
        return {
          time: typeof milestone.time === 'number' ? milestone.time : 0,
          label: typeof milestone.label === 'string' ? milestone.label : '',
          triggered: typeof milestone.triggered === 'boolean' ? milestone.triggered : undefined,
        };
      });

      // Calculate elapsed time since last sync
      const lastSynced = new Date(data.last_synced_at).getTime();
      const now = Date.now();
      const elapsedSinceSync = Math.floor((now - lastSynced) / 1000);
      
      // Adjust remaining seconds based on elapsed time (if not paused)
      const adjustedRemaining = data.is_paused 
        ? data.remaining_seconds 
        : Math.max(0, data.remaining_seconds - elapsedSinceSync);
      
      const adjustedTimeToNext = data.is_paused || data.time_to_next_milestone === null
        ? data.time_to_next_milestone
        : Math.max(0, data.time_to_next_milestone - elapsedSinceSync);

      // Parse next_milestone
      const rawNextMilestone = data.next_milestone as Record<string, unknown> | null;
      const nextMilestone: TimerMilestone | null = rawNextMilestone ? {
        time: typeof rawNextMilestone.time === 'number' ? rawNextMilestone.time : 0,
        label: typeof rawNextMilestone.label === 'string' ? rawNextMilestone.label : '',
        triggered: typeof rawNextMilestone.triggered === 'boolean' ? rawNextMilestone.triggered : undefined,
      } : null;

      timerDataRef.current = {
        startedAt: new Date().toISOString(),
        remainingAtStart: adjustedRemaining,
        totalSeconds: data.total_seconds,
        isPaused: data.is_paused,
        milestones,
        nextMilestone,
        timeToNextMilestoneAtStart: adjustedTimeToNext,
      };

      setTimerState({
        isActive: data.is_active && adjustedRemaining > 0,
        label: data.label || '',
        remainingSeconds: adjustedRemaining,
        totalSeconds: data.total_seconds,
        isPaused: data.is_paused,
        pausedByMilestone: data.paused_by_milestone,
        milestones,
        nextMilestone,
        timeToNextMilestone: adjustedTimeToNext,
        progress: data.total_seconds > 0 ? 1 - (adjustedRemaining / data.total_seconds) : 0,
      });
    } catch (error) {
      console.error('Error fetching cached timer:', error);
    }
  }, []);

  // Fetch from external API (for authenticated users)
  const fetchFromExternal = useCallback(async () => {
    if (!user || !session) return;

    try {
      const response = await fetch(
        'https://zmvkvpmwpyxdpbysomxl.supabase.co/functions/v1/get-active-timer',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        console.error('Error fetching timer data:', response.statusText);
        return;
      }

      const data = await response.json();

      // Edge function returns pre-calculated values
      if (!data || !data.isActive) {
        timerDataRef.current = null;
        setTimerState(initialState);
        // Also update cache to mark as inactive
        await cacheTimerData({
          externalUserId: user.id,
          ...initialState,
        });
        return;
      }

      const milestones: TimerMilestone[] = Array.isArray(data.milestones) 
        ? data.milestones as TimerMilestone[]
        : [];

      // Store ref data for local countdown
      timerDataRef.current = {
        startedAt: new Date().toISOString(), // Use current time as reference
        remainingAtStart: data.remainingSeconds || 0,
        totalSeconds: data.totalSeconds || 0,
        isPaused: data.isPaused || false,
        milestones,
        nextMilestone: data.nextMilestone || null,
        timeToNextMilestoneAtStart: data.timeToNextMilestone ?? null,
      };

      const newState: ExternalTimerState = {
        isActive: data.isActive,
        label: data.label || '',
        remainingSeconds: data.remainingSeconds || 0,
        totalSeconds: data.totalSeconds || 0,
        isPaused: data.isPaused || false,
        pausedByMilestone: data.pausedByMilestone || false,
        milestones,
        nextMilestone: data.nextMilestone || null,
        timeToNextMilestone: data.timeToNextMilestone || null,
        progress: Math.min(1, Math.max(0, data.progress || 0)),
      };

      setTimerState(newState);

      // Cache the timer data for public access
      await cacheTimerData({
        externalUserId: user.id,
        ...newState,
      });
    } catch (error) {
      console.error('Error fetching timer data:', error);
    }
  }, [user, session, cacheTimerData]);

  // Initial fetch and subscribe to updates
  useEffect(() => {
    if (isAuthenticated && user) {
      // Authenticated: fetch from external API
      fetchFromExternal();

      const channel = externalSupabase
        .channel(`timer-${user.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'shared_brewing_session',
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            fetchFromExternal();
          }
        )
        .subscribe();

      return () => {
        externalSupabase.removeChannel(channel);
      };
    } else {
      // Not authenticated: fetch from local cache
      fetchFromCache();

      // Subscribe to cache updates via realtime
      const channel = supabase
        .channel('cached-timer-updates')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'cached_external_timer',
          },
          () => {
            fetchFromCache();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [isAuthenticated, user, fetchFromExternal, fetchFromCache]);

  // Update remaining seconds every second when timer is active
  useEffect(() => {
    if (timerState.isActive && !timerState.isPaused) {
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
  }, [timerState.isActive, timerState.isPaused, updateTimerState]);

  return timerState;
}
