import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Manages splash screen visibility with minimum display time
 * and content paint detection.
 */
export function useSplashScreen(loading: boolean) {
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);
  const [contentPainted, setContentPainted] = useState(false);
  const [splashDelayMs, setSplashDelayMs] = useState(1000);

  const showSplash = !minTimeElapsed || !contentPainted;

  // Minimum 2s so logo is always visible
  useEffect(() => {
    const timer = setTimeout(() => setMinTimeElapsed(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  // Load splash delay from DB
  useEffect(() => {
    supabase.from('sync_settings').select('splash_delay_ms').limit(1).maybeSingle().then(({ data }) => {
      if (data?.splash_delay_ms != null) setSplashDelayMs(data.splash_delay_ms);
    });
  }, []);

  // Once data loaded, wait for lazy charts to resolve before removing splash
  useEffect(() => {
    if (!loading) {
      let cancelled = false;
      const timer = setTimeout(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!cancelled) {
              setContentPainted(true);
            }
          });
        });
      }, splashDelayMs);
      return () => { cancelled = true; clearTimeout(timer); };
    }
  }, [loading, splashDelayMs]);

  return { showSplash };
}
