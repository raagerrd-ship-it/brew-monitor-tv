import { lazy, Suspense, useState, useEffect, useCallback } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useTvMode } from '@/contexts/TvModeContext';
import type { BrewChartProps } from './types';

// Lazy load the heavy recharts-based BrewChart component
const BrewChartLazy = lazy(() => 
  import('./BrewChart').then(module => ({ default: module.BrewChart }))
);

const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Server-rendered chart image for TV mode.
 * Calls render-brew-chart edge function and displays result as static <img>.
 */
function TvModeChart({ brewId }: { brewId: string }) {
  const [chartUrl, setChartUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const fetchChart = useCallback(async () => {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(`${supabaseUrl}/functions/v1/render-brew-chart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brewId }),
      });

      if (!response.ok) throw new Error('Failed to render chart');
      
      const data = await response.json();
      // Cache-bust with timestamp
      setChartUrl(`${data.chartUrl}?t=${Date.now()}`);
      setError(false);
    } catch (e) {
      console.error('[TvModeChart] Error:', e);
      setError(true);
    }
  }, [brewId]);

  useEffect(() => {
    fetchChart();
    const interval = setInterval(fetchChart, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchChart]);

  if (error || !chartUrl) {
    return (
      <div className="relative w-full h-full">
        <Skeleton className="absolute inset-0 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      <img
        src={chartUrl}
        alt="Brew chart"
        className="absolute inset-0 w-full h-full rounded-lg"
        style={{ objectFit: 'fill' }}
        loading="lazy"
      />
    </div>
  );
}

/**
 * Lazy-loaded wrapper for BrewChart.
 * In TV mode: renders a server-generated static image (no Recharts).
 * In normal mode: lazy-loads Recharts (~150KB).
 */
export function LazyBrewChart(props: BrewChartProps) {
  const { isTvMode } = useTvMode();

  // TV mode: skip Recharts entirely, use server-rendered image
  if (isTvMode && props.brewId) {
    return <TvModeChart brewId={props.brewId} />;
  }

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
