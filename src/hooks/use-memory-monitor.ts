import { useEffect, useRef } from 'react';

interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface PerformanceWithMemory extends Performance {
  memory?: PerformanceMemory;
}

/**
 * Monitors memory usage and reloads the page if it exceeds a threshold.
 * Only works in Chromium-based browsers (Chrome, Edge, Chromecast).
 */
export function useMemoryMonitor(
  thresholdPercent: number = 90,
  checkIntervalMs: number = 30000,
  enabled: boolean = true
) {
  const lastLogRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;

    const perf = performance as PerformanceWithMemory;
    
    // Check if memory API is available (Chromium only)
    if (!perf.memory) {
      console.log('[Memory Monitor] Memory API not available in this browser');
      return;
    }

    console.log('[Memory Monitor] Started monitoring every', checkIntervalMs / 1000, 'seconds');

    const checkMemory = () => {
      if (!perf.memory) return;

      const { usedJSHeapSize, jsHeapSizeLimit } = perf.memory;
      const usagePercent = (usedJSHeapSize / jsHeapSizeLimit) * 100;
      
      // Log every 5 checks (2.5 minutes) or when above 70%
      const now = Date.now();
      if (usagePercent > 70 || now - lastLogRef.current > checkIntervalMs * 5) {
        console.log(`[Memory Monitor] Usage: ${usagePercent.toFixed(1)}% (${(usedJSHeapSize / 1024 / 1024).toFixed(1)}MB / ${(jsHeapSizeLimit / 1024 / 1024).toFixed(1)}MB)`);
        lastLogRef.current = now;
      }

      if (usagePercent >= thresholdPercent) {
        console.warn(`[Memory Monitor] Memory usage at ${usagePercent.toFixed(1)}% - exceeds ${thresholdPercent}% threshold. Reloading page...`);
        window.location.reload();
      }
    };

    // Initial check
    checkMemory();

    // Set up interval
    const intervalId = setInterval(checkMemory, checkIntervalMs);

    return () => {
      clearInterval(intervalId);
      console.log('[Memory Monitor] Stopped monitoring');
    };
  }, [thresholdPercent, checkIntervalMs, enabled]);
}
