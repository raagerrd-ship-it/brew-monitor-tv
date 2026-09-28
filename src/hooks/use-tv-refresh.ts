import { useEffect, useRef } from 'react';
import { subscribeSyncSettings } from '@/lib/sync-settings-store';

/**
 * In TV mode, listens for remote force-refresh signals via the shared
 * sync_settings source (realtime + 60 s poll).
 */
export function useTvRefresh(isTvMode: boolean) {
  const lastKnownRefreshAt = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!isTvMode) return;

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

    return subscribeSyncSettings((row) => {
      const newVal = row.force_tv_refresh_at ?? null;
      // Första värdet är baslinjen
      if (lastKnownRefreshAt.current === undefined) { lastKnownRefreshAt.current = newVal; return; }
      if (newVal && newVal !== lastKnownRefreshAt.current) triggerRefresh(newVal);
    });
  }, [isTvMode]);
}
