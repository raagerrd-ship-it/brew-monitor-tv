import { lazy, Suspense, useState, useEffect, useCallback } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useTvMode } from '@/contexts/TvModeContext';
import type { BrewChartProps } from './types';

// Lazy load the heavy recharts-based BrewChart component
const BrewChartLazy = lazy(() => 
  import('./BrewChart').then(module => ({ default: module.BrewChart }))
);



/**
 * Server-rendered chart image for TV mode.
 * Refreshes when lastUpdateRaw changes (data update) or every 15 min as fallback.
 */
function TvModeChart({ brewId, compact = false, lastUpdateRaw, brewCount = 2 }: { brewId: string; compact?: boolean; lastUpdateRaw?: string | null; brewCount?: number }) {
  const [visibleSvg, setVisibleSvg] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const fetchChart = useCallback(async (signal?: AbortSignal) => {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(`${supabaseUrl}/functions/v1/render-brew-chart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brewId, compact, brewCount }),
        signal,
      });

      if (!response.ok) throw new Error('Failed to render chart');
      
      // SVG returned inline — single round trip, no second fetch
      const svgText = await response.text();
      if (!signal?.aborted) {
        setVisibleSvg(svgText);
        setError(false);
      }
    } catch (e) {
      if (signal?.aborted) return;
      console.error('[TvModeChart] Error:', e);
      setError(true);
    }
  }, [brewId, compact, brewCount, lastUpdateRaw]);

  useEffect(() => {
    const controller = new AbortController();
    fetchChart(controller.signal);
    return () => controller.abort();
  }, [fetchChart]);

  useEffect(() => {
    if (!error || retryCount >= 3) return;
    const delay = (retryCount + 1) * 10000;
    const timer = setTimeout(() => {
      setError(false);
      setRetryCount(prev => prev + 1);
    }, delay);
    return () => clearTimeout(timer);
  }, [error, retryCount]);

  useEffect(() => {
    if (visibleSvg) setRetryCount(0);
  }, [visibleSvg]);

  if (!visibleSvg) {
    return (
      <div className="relative w-full h-full">
        <Skeleton className="absolute inset-0 rounded-lg" />
      </div>
    );
  }

  return (
    <div
      className="relative w-full h-full rounded-lg [&>svg]:w-full [&>svg]:h-full"
      dangerouslySetInnerHTML={{ __html: visibleSvg }}
    />
  );
}

/**
 * TV mode: server-rendered static chart images for performance.
 * Desktop & Mobile: interactive Recharts components.
 */
export function LazyBrewChart(props: BrewChartProps) {
  const { isTvMode } = useTvMode();

  // TV mode: use server-rendered chart images for hardware performance
  if (isTvMode && props.brewId) {
    return <TvModeChart brewId={props.brewId} compact={props.hasFermentationSession} lastUpdateRaw={props.lastUpdateRaw} brewCount={props.brewCount} />;
  }

  // Desktop & Mobile: interactive Recharts
  return (
    <Suspense fallback={
      <div className="h-full flex items-center justify-center">
        <Skeleton className="w-full h-full rounded-lg" />
      </div>
    }>
      <BrewChartLazy {...props} />
    </Suspense>
  );
}
