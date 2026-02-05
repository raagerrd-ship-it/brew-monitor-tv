import { useRef, useCallback } from 'react';

/**
 * A simple request throttler to prevent too many concurrent requests
 * on resource-constrained devices like Chromecast.
 * 
 * Returns a function that wraps async operations and ensures
 * only one runs at a time, queuing others.
 */
export function useRequestThrottle() {
  const pendingRef = useRef<Promise<any> | null>(null);
  const queueRef = useRef<(() => Promise<any>)[]>([]);
  const isProcessingRef = useRef(false);

  const processQueue = useCallback(async () => {
    if (isProcessingRef.current || queueRef.current.length === 0) return;
    
    isProcessingRef.current = true;
    
    while (queueRef.current.length > 0) {
      const nextTask = queueRef.current.shift();
      if (nextTask) {
        try {
          await nextTask();
        } catch (error) {
          console.error('[RequestThrottle] Task failed:', error);
        }
        // Small delay between requests to prevent overwhelming the device
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    isProcessingRef.current = false;
  }, []);

  const throttle = useCallback(<T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise((resolve, reject) => {
      queueRef.current.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      
      processQueue();
    });
  }, [processQueue]);

  return { throttle };
}

/**
 * Global request counter to detect potential overload situations
 */
let activeRequests = 0;
const MAX_CONCURRENT_REQUESTS = 6;

export function trackRequest<T>(fn: () => Promise<T>): Promise<T> {
  if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    console.warn('[RequestThrottle] Too many concurrent requests, delaying...');
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        trackRequest(fn).then(resolve).catch(reject);
      }, 500);
    });
  }
  
  activeRequests++;
  return fn().finally(() => {
    activeRequests--;
  });
}
