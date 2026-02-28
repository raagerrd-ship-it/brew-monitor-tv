import { useState, useCallback, useRef } from 'react';
import { tvDebug } from '@/lib/tv-debug-log';

let bgSwapCounter = 0;

/**
 * Preloads album art before setting as visible background
 * to prevent black flashes during transitions.
 */
export function useAlbumArtBackground() {
  const [visibleBgUrl, setVisibleBgUrl] = useState<string | null>(null);
  const visibleBgBaseRef = useRef<string | null>(null);
  const preloadingUrlRef = useRef<string | null>(null);

  const handleAlbumArtChange = useCallback((url: string | null, trackName?: string) => {
    const label = trackName ? `"${trackName}"` : '(okänd)';
    if (!url) {
      setVisibleBgUrl(null);
      visibleBgBaseRef.current = null;
      preloadingUrlRef.current = null;
      return;
    }
    const baseUrl = url.split('?')[0];
    if (baseUrl === visibleBgBaseRef.current) return;
    if (url === preloadingUrlRef.current) return;
    const flowId = `bg-swap-${++bgSwapCounter}`;
    preloadingUrlRef.current = url;
    tvDebug('bg', `⏳ Laddar bakgrund för ${label}...`, flowId);
    const img = new Image();
    img.onload = () => {
      visibleBgBaseRef.current = baseUrl;
      setVisibleBgUrl(url);
      preloadingUrlRef.current = null;
      tvDebug('bg', `✅ Bakgrund laddad för ${label} — bytt`, flowId);
    };
    img.onerror = () => {
      preloadingUrlRef.current = null;
      tvDebug('bg', `❌ Bakgrund misslyckades för ${label}`, flowId);
    };
    img.src = url;
  }, []);

  return { visibleBgUrl, handleAlbumArtChange };
}
