import { useState, useCallback, useRef } from 'react';

/**
 * Preloads album art before setting as visible background
 * to prevent black flashes during transitions.
 */
export function useAlbumArtBackground() {
  const [visibleBgUrl, setVisibleBgUrl] = useState<string | null>(null);
  const visibleBgBaseRef = useRef<string | null>(null);
  const preloadingUrlRef = useRef<string | null>(null);

  const handleAlbumArtChange = useCallback((url: string | null) => {
    if (!url) {
      setVisibleBgUrl(null);
      visibleBgBaseRef.current = null;
      preloadingUrlRef.current = null;
      return;
    }
    const baseUrl = url.split('?')[0];
    if (baseUrl === visibleBgBaseRef.current) return;
    if (url === preloadingUrlRef.current) return;
    preloadingUrlRef.current = url;
    const img = new Image();
    img.onload = () => {
      visibleBgBaseRef.current = baseUrl;
      setVisibleBgUrl(url);
      preloadingUrlRef.current = null;
    };
    img.onerror = () => { preloadingUrlRef.current = null; };
    img.src = url;
  }, []);

  return { visibleBgUrl, handleAlbumArtChange };
}
