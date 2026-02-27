import { useState, useEffect, useCallback } from 'react';
import { useTvMode } from '@/contexts/TvModeContext';

/**
 * Hook that defers rendering of heavy components using requestIdleCallback.
 * This ensures the main thread isn't blocked during initial page load.
 * Falls back to setTimeout if requestIdleCallback isn't available.
 * 
 * In TV mode, renders immediately since charts are already disabled there.
 * 
 * @param priority - 'high' renders sooner, 'low' waits longer (default: 'high')
 * @returns boolean - Whether the component should render
 */
export function useDeferredRender(priority: 'high' | 'low' = 'high'): boolean {
  const { isTvMode } = useTvMode();
  
  // In TV mode, render immediately - charts are disabled anyway
  const [shouldRender, setShouldRender] = useState(isTvMode);
  
  useEffect(() => {
    if (isTvMode) {
      setShouldRender(true);
      return;
    }
    
    // Use requestIdleCallback to wait for browser idle time
    if ('requestIdleCallback' in window) {
      const timeout = priority === 'high' ? 200 : 500;
      const idleId = window.requestIdleCallback(
        () => setShouldRender(true),
        { timeout }
      );
      return () => window.cancelIdleCallback(idleId);
    } else {
      // Fallback for Safari/older browsers
      const delay = priority === 'high' ? 100 : 300;
      const timeoutId = setTimeout(() => setShouldRender(true), delay);
      return () => clearTimeout(timeoutId);
    }
  }, [isTvMode, priority]);
  
  return shouldRender;
}

/**
 * Hook for staggered rendering of multiple components using requestIdleCallback.
 * Each component waits for browser idle time before rendering.
 * This prevents multiple heavy components from rendering simultaneously.
 * 
 * In TV mode, renders everything immediately since heavy components are disabled.
 * 
 * @param index - Index of the component (0-based)
 * @returns boolean - Whether the component should render
 */
export function useStaggeredRender(index: number): boolean {
  const { isTvMode } = useTvMode();
  
  // In TV mode, render everything immediately
  const [shouldRender, setShouldRender] = useState(isTvMode);
  
  useEffect(() => {
    if (isTvMode || shouldRender) {
      // Already rendering, nothing to do
      return;
    }
    
    // Stagger each component by waiting for idle + small delay per index
    const baseDelay = 150;
    const staggerDelay = 100 * index;
    const totalDelay = baseDelay + staggerDelay;
    
    if ('requestIdleCallback' in window) {
      let cancelled = false;
      
      const idleId = window.requestIdleCallback(
        () => {
          if (!cancelled) setShouldRender(true);
        },
        { timeout: totalDelay + 500 }
      );
      
      // Fallback timeout in case idle never fires
      const timeoutId = setTimeout(() => {
        if (!cancelled) {
          window.cancelIdleCallback(idleId);
          setShouldRender(true);
        }
      }, totalDelay + 1000);
      
      return () => {
        cancelled = true;
        window.cancelIdleCallback(idleId);
        clearTimeout(timeoutId);
      };
    } else {
      const timeoutId = setTimeout(() => setShouldRender(true), totalDelay);
      return () => clearTimeout(timeoutId);
    }
  }, [index, isTvMode]); // Removed shouldRender from deps to prevent loop
  
  return shouldRender;
}
