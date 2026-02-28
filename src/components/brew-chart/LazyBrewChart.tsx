import { lazy, Suspense, useState, useEffect, useCallback, useRef } from 'react';
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
  const fetchIdRef = useRef(0);

  // Stable fetch function — does NOT depend on lastUpdateRaw to avoid abort chains
  const doFetch = useCallback(async (signal?: AbortSignal) => {
    const t0 = performance.now();
    console.log(`[TvModeChart] Fetching chart for ${brewId} (compact=${compact}, brewCount=${brewCount})`);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(`${supabaseUrl}/functions/v1/render-brew-chart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brewId, compact, brewCount }),
        signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '(unreadable)');
        throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
      }
      
      const svgText = await response.text();
      if (!signal?.aborted) {
        const svgSize = svgText.length;
        const hasSvgTag = svgText.trimStart().startsWith('<svg');
        console.log(`[TvModeChart] ✅ ${brewId} loaded in ${Math.round(performance.now() - t0)}ms (${svgSize} bytes, valid=${hasSvgTag})`);
        if (!hasSvgTag) {
          console.error(`[TvModeChart] ❌ Response is not SVG:`, svgText.slice(0, 300));
          setError(true);
          return;
        }
        setVisibleSvg(svgText);
        setError(false);
        setRetryCount(0);
      } else {
        console.log(`[TvModeChart] ⚠️ ${brewId} aborted after ${Math.round(performance.now() - t0)}ms`);
      }
    } catch (e: any) {
      if (signal?.aborted) {
        console.log(`[TvModeChart] ⚠️ ${brewId} fetch aborted (cleanup)`);
        return;
      }
      console.error(`[TvModeChart] ❌ ${brewId} failed after ${Math.round(performance.now() - t0)}ms:`, e?.message || e);
      setError(true);
    }
  }, [brewId, compact, brewCount]);

  // Initial fetch on mount — only depends on brewId/compact/brewCount (stable)
  useEffect(() => {
    console.log(`[TvModeChart] Mount — starting fetch for ${brewId}`);
    const controller = new AbortController();
    doFetch(controller.signal);
    return () => {
      console.log(`[TvModeChart] Unmount — aborting fetch for ${brewId}`);
      controller.abort();
    };
  }, [doFetch]);

  // Debounced refresh when lastUpdateRaw changes — does NOT abort the previous fetch
  useEffect(() => {
    if (!lastUpdateRaw) return;
    // Skip the initial mount trigger (handled above)
    const id = ++fetchIdRef.current;
    const timer = setTimeout(() => {
      if (id !== fetchIdRef.current) return; // stale
      console.log(`[TvModeChart] 🔄 Data updated — refreshing chart for ${brewId} (lastUpdate=${lastUpdateRaw})`);
      doFetch();
    }, 2000); // 2s debounce to let multiple data updates settle
    return () => clearTimeout(timer);
  }, [lastUpdateRaw, doFetch]);

  // Retry on error
  useEffect(() => {
    if (!error || retryCount >= 3) {
      if (error && retryCount >= 3) console.error(`[TvModeChart] ❌ ${brewId} gave up after ${retryCount} retries`);
      return;
    }
    const delay = (retryCount + 1) * 10000;
    console.log(`[TvModeChart] 🔄 ${brewId} retry ${retryCount + 1}/3 in ${delay / 1000}s`);
    const timer = setTimeout(() => {
      setError(false);
      setRetryCount(prev => prev + 1);
      doFetch();
    }, delay);
    return () => clearTimeout(timer);
  }, [error, retryCount, doFetch]);

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
