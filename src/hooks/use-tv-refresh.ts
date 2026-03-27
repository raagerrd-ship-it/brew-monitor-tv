import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * In TV mode, listens for remote force-refresh signals via
 * realtime subscription + polling fallback every 30s.
 */
export function useTvRefresh(isTvMode: boolean) {
  const lastKnownRefreshAt = useRef<string | null>(null);

  useEffect(() => {
    if (!isTvMode) return;

    // Initialize with current value from DB
    supabase.from('sync_settings').select('force_tv_refresh_at').limit(1).maybeSingle().then(({ data }) => {
      lastKnownRefreshAt.current = data?.force_tv_refresh_at ?? null;
    });

    const triggerRefresh = (newVal: string) => {
      console.log('[TV] Remote refresh triggered');
      lastKnownRefreshAt.current = newVal;
      setTimeout(async () => {
        if ('caches' in window) {
          const names = await caches.keys();
          await Promise.all(names.map(n => caches.delete(n)));
        }
        const params = new URLSearchParams(window.location.search);
        params.set('v', Date.now().toString());
        window.location.href = window.location.origin + window.location.pathname + '?' + params.toString();
      }, 500);
    };

    // Realtime subscription for sync_settings changes
    const channel = supabase
      .channel('tv-sync-settings')
      .on('postgres_changes' as any, { event: 'UPDATE', schema: 'public', table: 'sync_settings' }, (payload: any) => {
        const newVal = payload.new?.force_tv_refresh_at;
        if (newVal && newVal !== lastKnownRefreshAt.current) {
          triggerRefresh(newVal);
        }
      })
      .subscribe();

    // Polling fallback every 30s
    const pollInterval = setInterval(async () => {
      try {
        const { data } = await supabase
          .from('sync_settings')
          .select('force_tv_refresh_at')
          .limit(1)
          .maybeSingle();
        const newVal = data?.force_tv_refresh_at;
        if (newVal && newVal !== lastKnownRefreshAt.current) {
          triggerRefresh(newVal);
        }
      } catch {
        // Ignore polling errors
      }
    }, 30000);

    return () => {
      onSyncSettingsChange.current = null;
      clearInterval(pollInterval);
    };
  }, [isTvMode, onSyncSettingsChange]);
}
