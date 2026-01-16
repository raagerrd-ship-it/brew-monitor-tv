import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
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
 */
export function useRealtimeSubscription({
  table,
  schema = 'public',
  event = '*',
  filter,
  onPayload,
  enabled = true,
}: RealtimeSubscriptionOptions) {
  // Use ref to avoid re-subscribing when callback changes
  const callbackRef = useRef(onPayload);
  callbackRef.current = onPayload;

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
            callbackRef.current(payload);
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
            callbackRef.current(payload);
          }
        )
        .subscribe();
    }

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, schema, event, filter, enabled]);
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
