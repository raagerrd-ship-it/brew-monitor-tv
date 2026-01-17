import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTvMode } from '@/contexts/TvModeContext';
import type { RealtimeChannel } from '@supabase/supabase-js';

type PostgresEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

interface RealtimeSubscriptionOptions {
  table: string;
  schema?: string;
  event?: PostgresEvent;
  filter?: string;
  onPayload: (payload: any) => void;
  enabled?: boolean;
}

/**
 * Generic hook for Supabase realtime subscriptions.
 * Handles channel creation, subscription, and cleanup automatically.
 * In TV mode, events are batched/debounced to reduce re-renders.
 */
export function useRealtimeSubscription({
  table,
  schema = 'public',
  event = '*',
  filter,
  onPayload,
  enabled = true,
}: RealtimeSubscriptionOptions) {
  const { isTvMode } = useTvMode();
  
  // Use ref to avoid re-subscribing when callback changes
  const callbackRef = useRef(onPayload);
  callbackRef.current = onPayload;
  
  // Refs for batching in TV mode
  const pendingPayloadRef = useRef<any>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced callback for TV mode - batch updates together
  const processPayload = useCallback((payload: any) => {
    if (isTvMode) {
      // Batch updates - wait 2 seconds and use the latest
      pendingPayloadRef.current = payload;
      
      if (!timeoutRef.current) {
        timeoutRef.current = setTimeout(() => {
          if (pendingPayloadRef.current) {
            callbackRef.current(pendingPayloadRef.current);
            pendingPayloadRef.current = null;
          }
          timeoutRef.current = null;
        }, 2000);
      }
    } else {
      callbackRef.current(payload);
    }
  }, [isTvMode]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const channelName = `${table}-${filter || 'all'}-${Date.now()}`;
    
    let channel: RealtimeChannel;
    
    if (filter) {
      channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes' as any,
          {
            event,
            schema,
            table,
            filter,
          },
          (payload: any) => {
            processPayload(payload);
          }
        )
        .subscribe();
    } else {
      channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes' as any,
          {
            event,
            schema,
            table,
          },
          (payload: any) => {
            processPayload(payload);
          }
        )
        .subscribe();
    }

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, schema, event, filter, enabled, processPayload]);
}

/**
 * Hook for subscribing to multiple tables at once.
 * More efficient than multiple useRealtimeSubscription calls.
 */
export function useMultiTableRealtime(
  subscriptions: Array<{
    table: string;
    filter?: string;
    onPayload: () => void;
  }>,
  enabled = true
) {
  const callbacksRef = useRef(subscriptions.map(s => s.onPayload));
  callbacksRef.current = subscriptions.map(s => s.onPayload);

  useEffect(() => {
    if (!enabled || subscriptions.length === 0) return;

    const channels: RealtimeChannel[] = subscriptions.map((sub, index) => {
      const channelName = `multi-${sub.table}-${sub.filter || 'all'}-${Date.now()}-${index}`;
      
      const channelConfig: any = {
        event: '*',
        schema: 'public',
        table: sub.table,
      };
      
      if (sub.filter) {
        channelConfig.filter = sub.filter;
      }
      
      return supabase
        .channel(channelName)
        .on(
          'postgres_changes' as any,
          channelConfig,
          () => {
            callbacksRef.current[index]?.();
          }
        )
        .subscribe();
    });

    return () => {
      channels.forEach(channel => supabase.removeChannel(channel));
    };
  }, [subscriptions.map(s => `${s.table}-${s.filter}`).join(','), enabled]);
}
