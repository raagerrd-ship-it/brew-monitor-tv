import { useState, useEffect } from 'react';
import { useTvMode } from '@/contexts/TvModeContext';

/**
 * Hook that defers rendering of heavy components to prevent blocking the main thread.
 * Especially useful in TV mode where page updates should not freeze the UI.
 * 
 * @param delayMs - Delay in milliseconds before rendering (default: 50ms, TV mode: 150ms)
 * @returns boolean - Whether the component should render
 */
export function useDeferredRender(delayMs?: number): boolean {
  const [shouldRender, setShouldRender] = useState(false);
  const { isTvMode } = useTvMode();
  
  // Use longer delay in TV mode to ensure basic UI renders first
  const delay = delayMs ?? (isTvMode ? 150 : 50);
  
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
 * 
 * @param index - Index of the component (0-based)
 * @param baseDelayMs - Base delay between each component (default: 30ms)
 * @returns boolean - Whether the component should render
 */
export function useStaggeredRender(index: number, baseDelayMs = 30): boolean {
  const [shouldRender, setShouldRender] = useState(false);
  const { isTvMode } = useTvMode();
  
  // In TV mode, use slightly longer stagger
  const staggerDelay = isTvMode ? baseDelayMs * 1.5 : baseDelayMs;
  const delay = index * staggerDelay;
  
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setShouldRender(true);
    }, delay);
    
    return () => clearTimeout(timeoutId);
  }, [delay]);
  
  return shouldRender;
}
