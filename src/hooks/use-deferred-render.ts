import { useState, useEffect } from 'react';
import { useTvMode } from '@/contexts/TvModeContext';

/**
 * Hook that defers rendering of heavy components to prevent blocking the main thread.
 * Especially useful in TV mode where page updates should not freeze the UI.
 * 
 * @param delayMs - Delay in milliseconds before rendering (default: 50ms, TV mode: 200ms)
 * @returns boolean - Whether the component should render
 */
export function useDeferredRender(delayMs?: number): boolean {
  const [shouldRender, setShouldRender] = useState(false);
  const { isTvMode } = useTvMode();
  
  // Use longer delay in TV mode to ensure basic UI renders first
  const delay = delayMs ?? (isTvMode ? 400 : 50);
  
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setShouldRender(true);
    }, delay);
    
    return () => clearTimeout(timeoutId);
  }, [delay]);
  
  return shouldRender;
}

/**
 * Hook for staggered rendering of multiple components.
 * Each component gets an incremental delay based on its index.
 * In TV mode, uses much longer delays to prevent casting issues.
 * 
 * @param index - Index of the component (0-based)
 * @param baseDelayMs - Base delay between each component (default: 50ms normal, 500ms TV mode)
 * @returns boolean - Whether the component should render
 */
export function useStaggeredRender(index: number, baseDelayMs?: number): boolean {
  const [shouldRender, setShouldRender] = useState(false);
  const { isTvMode } = useTvMode();
  
  // In TV mode, use MUCH longer stagger to prevent blocking
  const staggerDelay = baseDelayMs ?? (isTvMode ? 1000 : 50);
  // Initial delay before first component + stagger per component
  const initialDelay = isTvMode ? 500 : 100;
  const delay = initialDelay + (index * staggerDelay);
  
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setShouldRender(true);
    }, delay);
    
    return () => clearTimeout(timeoutId);
  }, [delay]);
  
  return shouldRender;
}
