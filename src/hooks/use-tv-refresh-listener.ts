import { useEffect, useRef } from 'react';
import { supabase } from "@/integrations/supabase/client";
import { useTvMode } from "@/contexts/TvModeContext";
import { toast as sonnerToast } from 'sonner';

/**
 * Hook that listens for force_tv_refresh_at changes in sync_settings
 * and triggers a hard reload when the timestamp changes.
 * Only active when in TV mode.
 */
export const useTvRefreshListener = () => {
  const { isTvMode } = useTvMode();
  const lastRefreshAt = useRef<string | null>(null);
  const isInitialized = useRef(false);

  useEffect(() => {
    if (!isTvMode) return;

    console.log('[TV Refresh] Listener started - waiting for refresh commands');

    // Initialize with current value
    const initializeRefreshTimestamp = async () => {
      try {
        const { data, error } = await supabase
          .from('sync_settings')
          .select('force_tv_refresh_at')
          .limit(1)
          .single();

        if (!error && data) {
          lastRefreshAt.current = data.force_tv_refresh_at;
          isInitialized.current = true;
          console.log('[TV Refresh] Initialized with timestamp:', data.force_tv_refresh_at);
        }
      } catch (err) {
        console.error('[TV Refresh] Failed to initialize:', err);
      }
    };

    initializeRefreshTimestamp();

    const channel = supabase
      .channel('tv-refresh-listener')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'sync_settings',
        },
        (payload) => {
          const newData = payload.new as { force_tv_refresh_at?: string | null };
          const newRefreshAt = newData?.force_tv_refresh_at;

          console.log('[TV Refresh] Received update:', { newRefreshAt, lastRefreshAt: lastRefreshAt.current, isInitialized: isInitialized.current });

          // Only trigger reload if initialized and timestamp actually changed
          if (isInitialized.current && newRefreshAt && newRefreshAt !== lastRefreshAt.current) {
            lastRefreshAt.current = newRefreshAt;
            
            console.log('[TV Refresh] Refresh command detected - reloading page');
            
            sonnerToast('Uppdatering begärd', {
              description: 'Laddar om sidan...',
              duration: 2000,
            });

            // Wait for toast to show, then clear caches and reload
            setTimeout(async () => {
              try {
                // Clear Service Worker caches
                if ('caches' in window) {
                  const cacheNames = await caches.keys();
                  await Promise.all(cacheNames.map(name => caches.delete(name)));
                  console.log('[TV Refresh] Caches cleared:', cacheNames.length);
                }

                // Unregister Service Workers
                if ('serviceWorker' in navigator) {
                  const registrations = await navigator.serviceWorker.getRegistrations();
                  await Promise.all(registrations.map(reg => reg.unregister()));
                  console.log('[TV Refresh] Service workers unregistered:', registrations.length);
                }

                // Hard reload with cache buster, preserving existing params
                const currentParams = new URLSearchParams(window.location.search);
                currentParams.set('v', Date.now().toString());
                window.location.href = window.location.origin + window.location.pathname + '?' + currentParams.toString();
              } catch (error) {
                console.error('[TV Refresh] Cache clear failed, reloading anyway:', error);
                window.location.reload();
              }
            }, 1500);
          }
        }
      )
      .subscribe();

    return () => {
      console.log('[TV Refresh] Listener stopped');
      supabase.removeChannel(channel);
    };
  }, [isTvMode]);
};
