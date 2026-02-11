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
function TvModeChart({ brewId, compact = false, lastUpdateRaw }: { brewId: string; compact?: boolean; lastUpdateRaw?: string | null }) {
  const [chartUrl, setChartUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const fetchChart = useCallback(async () => {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(`${supabaseUrl}/functions/v1/render-brew-chart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brewId, compact }),
      });

      if (!response.ok) throw new Error('Failed to render chart');
      
      const data = await response.json();
      setChartUrl(`${data.chartUrl}?t=${Date.now()}`);
      setError(false);
    } catch (e) {
      console.error('[TvModeChart] Error:', e);
      setError(true);
    }
  }, [brewId, compact]);

  // Refresh when data changes (lastUpdateRaw) - no polling needed
  useEffect(() => {
    fetchChart();
  }, [fetchChart, lastUpdateRaw]);

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
 * TV mode: server-rendered static chart images for performance.
 * Desktop & Mobile: interactive Recharts components.
 */
export function LazyBrewChart(props: BrewChartProps) {
  const { isTvMode } = useTvMode();

  // TV mode: use server-rendered chart images for hardware performance
  if (isTvMode && props.brewId) {
    return <TvModeChart brewId={props.brewId} compact={props.hasFermentationSession} lastUpdateRaw={props.lastUpdateRaw} />;
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
