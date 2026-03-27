import { createContext, useContext, useState, useCallback, ReactNode, useRef } from 'react';
import { tvDebug } from '@/lib/tv-debug-log';

let bgSwapCounter = 0;

interface AlbumArtContextType {
  visibleBgUrl: string | null;
  handleAlbumArtChange: (url: string | null, trackName?: string) => void;
}

const AlbumArtContext = createContext<AlbumArtContextType>({
  visibleBgUrl: null,
  handleAlbumArtChange: () => {},
});

export function useAlbumArt() {
  return useContext(AlbumArtContext);
}

export function AlbumArtProvider({ children }: { children: ReactNode }) {
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
      if (preloadingUrlRef.current !== url) {
        tvDebug('bg', `⏭️ Bakgrund laddad för ${label} men redan rensad/bytt — ignorerar`, flowId);
        return;
      }
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

  return (
    <AlbumArtContext.Provider value={{ visibleBgUrl, handleAlbumArtChange }}>
      {children}
    </AlbumArtContext.Provider>
  );
}
