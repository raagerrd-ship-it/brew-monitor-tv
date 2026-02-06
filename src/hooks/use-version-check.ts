import { useEffect, useRef, useState } from 'react';
import { toast as sonnerToast } from 'sonner';

// Check for new app versions by comparing the HTML content
export const useVersionCheck = (checkInterval = 60000) => { // Default: check every minute. Pass 0 to disable.
  const lastHtmlHash = useRef<string | null>(null);
  const appLoadTime = useRef(new Date());
  const isFirstCheck = useRef(true);

  useEffect(() => {
    if (checkInterval <= 0) return; // Disabled
    const hashString = async (str: string): Promise<string> => {
      const encoder = new TextEncoder();
      const data = encoder.encode(str);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    };

    const checkForUpdate = async () => {
      try {
        // Fetch the main HTML with cache-busting
        const response = await fetch(`/?_=${Date.now()}`, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
          },
        });
        
        if (!response.ok) return;
        
        const html = await response.text();
        
        // Extract script src attributes
        const scriptMatches = html.match(/<script[^>]*src="([^"]*)"[^>]*>/g) || [];
        const linkMatches = html.match(/<link[^>]*href="([^"]*)"[^>]*>/g) || [];
        
        // Extract just the file paths without query parameters (strips Vite's ?t=xxx timestamps)
        // This prevents false positives from dev server timestamp changes
        const extractPath = (tag: string) => {
          const match = tag.match(/(?:src|href)="([^"?]+)/);
          return match ? match[1] : '';
        };
        
        const resourcePaths = [
          ...scriptMatches.map(extractPath),
          ...linkMatches.map(extractPath)
        ].filter(Boolean).join('|');
        
        const resourcesHash = await hashString(resourcePaths);
        
        if (isFirstCheck.current) {
          lastHtmlHash.current = resourcesHash;
          isFirstCheck.current = false;
          console.log('Version check initialized with hash:', resourcesHash.substring(0, 8));
          return;
        }
        
        if (lastHtmlHash.current && resourcesHash !== lastHtmlHash.current) {
          console.log('New version detected!');
          console.log('Old hash:', lastHtmlHash.current.substring(0, 8));
          console.log('New hash:', resourcesHash.substring(0, 8));
          
          sonnerToast('Ny version tillgänglig', {
            description: 'Rensar cache och uppdaterar...',
            duration: 3000,
          });
          
          // Update the hash before reload to prevent multiple reloads
          lastHtmlHash.current = resourcesHash;
          
          // Wait for toast to show, then clear caches and reload
          setTimeout(async () => {
            try {
              // 1. Signal waiting Service Worker to activate immediately
              if ('serviceWorker' in navigator) {
                const registration = await navigator.serviceWorker.getRegistration();
                if (registration?.waiting) {
                  console.log('Found waiting SW, sending SKIP_WAITING...');
                  registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                  await new Promise<void>(resolve => {
                    const onControllerChange = () => {
                      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
                      console.log('New SW activated');
                      resolve();
                    };
                    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
                    setTimeout(() => {
                      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
                      console.log('SW activation timeout, proceeding anyway');
                      resolve();
                    }, 3000);
                  });
                }
              }

              // 2. Clear all Service Worker caches
              if ('caches' in window) {
                const cacheNames = await caches.keys();
                await Promise.all(cacheNames.map(name => caches.delete(name)));
                console.log('Service Worker caches cleared:', cacheNames);
              }
              
              // 3. Unregister all Service Workers
              if ('serviceWorker' in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                await Promise.all(registrations.map(reg => reg.unregister()));
                console.log('Service Workers unregistered:', registrations.length);
              }
              
              // 4. Force hard reload while preserving existing query params (like ?tv=true)
              const currentParams = new URLSearchParams(window.location.search);
              currentParams.set('v', Date.now().toString());
              window.location.href = window.location.origin + window.location.pathname + '?' + currentParams.toString();
            } catch (error) {
              console.error('Cache clear failed, forcing reload anyway:', error);
              window.location.reload();
            }
          }, 2000);
        } else {
          console.log('Version check: no changes detected');
        }
      } catch (error) {
        console.error('Version check failed:', error);
      }
    };

    // Initial check after a short delay
    const initialTimeout = setTimeout(checkForUpdate, 5000);
    
    // Set up periodic checks
    const interval = setInterval(checkForUpdate, checkInterval);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [checkInterval]);

  return { appLoadTime: appLoadTime.current };
};
