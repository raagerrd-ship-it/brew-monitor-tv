import { createContext, useContext, useState, useCallback, ReactNode, useRef } from 'react';

type AlbumArtChange = (url: string | null, trackName?: string) => void;
const AlbumArtSetterContext = createContext<AlbumArtChange>(() => {});

/** Stable setter only — consumers don't re-render on background swaps */
export function useAlbumArtSetter() {
  return useContext(AlbumArtSetterContext);
}
import { tvDebug } from '@/lib/tv-debug-log';

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
    preloadingUrlRef.current = url;
    const img = new Image();
    img.decoding = 'async';
    const apply = () => {
      if (preloadingUrlRef.current !== url) {
        tvDebug('bg', `⏭️ Bakgrund laddad för ${label} men redan rensad/bytt — ignorerar`);
        return;
      }
      visibleBgBaseRef.current = baseUrl;
      setVisibleBgUrl(url);
      preloadingUrlRef.current = null;
      tvDebug('bg', `✅ Bakgrund laddad för ${label} — bytt`);
    };
    const fail = () => {
      preloadingUrlRef.current = null;
      tvDebug('bg', `❌ Bakgrund misslyckades för ${label}`);
    };
    img.src = url;
    img.decode().then(apply, fail);
  }, []);

  return (
    <AlbumArtSetterContext.Provider value={handleAlbumArtChange}>
      <AlbumArtContext.Provider value={{ visibleBgUrl, handleAlbumArtChange }}>
        {children}
      </AlbumArtContext.Provider>
    </AlbumArtSetterContext.Provider>
  );
}
