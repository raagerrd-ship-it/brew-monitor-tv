import { useState, useEffect } from 'react';
import { useTvMode } from '@/contexts/TvModeContext';

/**
 * Hook that defers rendering of heavy components to prevent blocking the main thread.
 * In TV mode, we skip deferring since we want immediate render without setTimeout overhead.
 * 
 * @param delayMs - Delay in milliseconds before rendering (default: 50ms, TV mode: 0ms)
 * @returns boolean - Whether the component should render
 */
export function useDeferredRender(delayMs?: number): boolean {
  const { isTvMode } = useTvMode();
  
  // In TV mode, render immediately - no deferring to avoid timeout overhead
  const [shouldRender, setShouldRender] = useState(isTvMode);
  
  // On desktop/mobile, use short delay
  const delay = delayMs ?? 50;
  
  useEffect(() => {
    if (isTvMode) {
      setShouldRender(true);
      return;
    }
    
    const timeoutId = setTimeout(() => {
      setShouldRender(true);
    }, delay);
    
    return () => clearTimeout(timeoutId);
  }, [delay, isTvMode]);
  
  return shouldRender;
}

/**
 * Hook for staggered rendering of multiple components.
 * In TV mode, renders everything immediately to avoid timeout overhead.
 * On desktop/mobile, staggers rendering for smoother initial load.
 * 
 * @param index - Index of the component (0-based)
 * @param baseDelayMs - Base delay between each component (default: 50ms)
 * @returns boolean - Whether the component should render
 */
export function useStaggeredRender(index: number, baseDelayMs?: number): boolean {
  const { isTvMode } = useTvMode();
  
  // In TV mode, render everything immediately - no staggering
  const [shouldRender, setShouldRender] = useState(isTvMode);
  
  const staggerDelay = baseDelayMs ?? 50;
  const initialDelay = 100;
  const delay = initialDelay + (index * staggerDelay);
  
  useEffect(() => {
    if (isTvMode) {
      setShouldRender(true);
      return;
    }
    
    const timeoutId = setTimeout(() => {
      setShouldRender(true);
    }, delay);
    
    return () => clearTimeout(timeoutId);
  }, [delay, isTvMode]);
  
  return shouldRender;
}
