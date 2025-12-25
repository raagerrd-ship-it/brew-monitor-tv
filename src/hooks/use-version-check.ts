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
          },
        });
        
        if (!response.ok) return;
        
        const html = await response.text();
        
        // Extract script tags to detect bundle changes
        const scriptMatches = html.match(/<script[^>]*src="[^"]*"[^>]*>/g);
        const scriptsHash = await hashString(scriptMatches?.join('') || '');
        
        if (isFirstCheck.current) {
          lastHtmlHash.current = scriptsHash;
          isFirstCheck.current = false;
          console.log('Version check initialized');
          return;
        }
        
        if (lastHtmlHash.current && scriptsHash !== lastHtmlHash.current) {
          console.log('New version detected, reloading...');
          sonnerToast('Ny version tillgänglig', {
            description: 'Sidan uppdateras automatiskt...',
            duration: 3000,
          });
          
          // Wait for toast to show, then reload
          setTimeout(() => {
            window.location.reload();
          }, 2000);
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
