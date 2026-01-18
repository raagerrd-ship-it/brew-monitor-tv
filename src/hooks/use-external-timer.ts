import { useState, useEffect, useCallback, useRef } from 'react';
import { externalSupabase } from '@/integrations/external-supabase/client';
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

  const fetchTimerData = useCallback(async () => {
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

      setTimerState({
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
      });
    } catch (error) {
      console.error('Error fetching timer data:', error);
    }
  }, [user, session]);

  // Initial fetch and subscribe to realtime updates
  useEffect(() => {
    if (!isAuthenticated || !user) {
      setTimerState(initialState);
      return;
    }

    fetchTimerData();

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
          fetchTimerData();
        }
      )
      .subscribe();

    return () => {
      externalSupabase.removeChannel(channel);
    };
  }, [isAuthenticated, user, fetchTimerData]);

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
