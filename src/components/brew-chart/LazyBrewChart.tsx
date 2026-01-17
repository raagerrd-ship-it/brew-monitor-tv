import { lazy, Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import type { BrewChartProps } from './types';

// Lazy load the heavy recharts-based BrewChart component
const BrewChartLazy = lazy(() => 
  import('./BrewChart').then(module => ({ default: module.BrewChart }))
);

/**
 * Lazy-loaded wrapper for BrewChart.
 * Reduces initial bundle size by deferring recharts loading (~150KB).
 */
export function LazyBrewChart(props: BrewChartProps) {
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
