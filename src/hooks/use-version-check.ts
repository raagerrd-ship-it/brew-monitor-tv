import { useEffect, useRef } from 'react';
import { toast as sonnerToast } from 'sonner';

// Check for new app versions by comparing the HTML content
export const useVersionCheck = (checkInterval = 60000) => { // Default: check every minute
  const lastHtmlHash = useRef<string | null>(null);
  const isFirstCheck = useRef(true);

  useEffect(() => {
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
        
        // Extract ALL script tags including their full src attributes with timestamps
        // This catches both bundle hash changes and Vite timestamp changes (?t=xxx)
        const scriptMatches = html.match(/<script[^>]*src="([^"]*)"[^>]*>/g);
        
        // Also extract link tags for CSS changes
        const linkMatches = html.match(/<link[^>]*href="([^"]*)"[^>]*>/g);
        
        // Combine all resource references for comparison
        const resourcesString = [
          ...(scriptMatches || []),
          ...(linkMatches || [])
        ].join('|');
        
        const resourcesHash = await hashString(resourcesString);
        
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
            description: 'Sidan uppdateras automatiskt...',
            duration: 3000,
          });
          
          // Update the hash before reload to prevent multiple reloads
          lastHtmlHash.current = resourcesHash;
          
          // Wait for toast to show, then force reload with cache clear
          setTimeout(() => {
            // Force a hard reload to bypass cache
            window.location.href = window.location.href.split('?')[0] + '?reload=' + Date.now();
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
};
