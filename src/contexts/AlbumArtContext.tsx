import { createContext, useContext, useState, useCallback, useMemo, ReactNode, useRef } from 'react';

type AlbumArtChange = (url: string | null, trackName?: string, accentColor?: string | null) => void;
const AlbumArtSetterContext = createContext<AlbumArtChange>(() => {});

/** Stable setter only — consumers don't re-render on background swaps */
export function useAlbumArtSetter() {
  return useContext(AlbumArtSetterContext);
}
import { tvDebug } from '@/lib/tv-debug-log';

interface AlbumArtContextType {
  visibleBgUrl: string | null;
  handleAlbumArtChange: AlbumArtChange;
}

const AlbumArtContext = createContext<AlbumArtContextType>({
  visibleBgUrl: null,
  handleAlbumArtChange: () => {},
});

const HasAlbumArtContext = createContext(false);
/** Bara om en bakgrund finns — ingen omritning vid varje låtbyte */
export function useHasAlbumArtBackground() {
  return useContext(HasAlbumArtContext);
}

export function useAlbumArt() {
  return useContext(AlbumArtContext);
}

export function AlbumArtProvider({ children }: { children: ReactNode }) {
  const [visibleBgUrl, setVisibleBgUrl] = useState<string | null>(null);
  const visibleBgBaseRef = useRef<string | null>(null);
  const preloadingUrlRef = useRef<string | null>(null);

  const handleAlbumArtChange = useCallback((url: string | null, trackName?: string, accentColor?: string | null) => {
    const label = trackName ? `"${trackName}"` : '(okänd)';
    if (!url) {
      document.documentElement.style.removeProperty('--album-accent');
      setVisibleBgUrl(null);
      visibleBgBaseRef.current = null;
      preloadingUrlRef.current = null;
      return;
    }
    const baseUrl = url.split('?')[0];
    if (baseUrl === visibleBgBaseRef.current) {
      if (accentColor) document.documentElement.style.setProperty('--album-accent', accentColor);
      return;
    }
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
      if (accentColor) document.documentElement.style.setProperty('--album-accent', accentColor);
      else document.documentElement.style.removeProperty('--album-accent');
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

  const value = useMemo(() => ({ visibleBgUrl, handleAlbumArtChange }), [visibleBgUrl, handleAlbumArtChange]);
  return (
    <AlbumArtSetterContext.Provider value={handleAlbumArtChange}>
      <AlbumArtContext.Provider value={value}>
        <HasAlbumArtContext.Provider value={!!visibleBgUrl}>
          {children}
        </HasAlbumArtContext.Provider>
      </AlbumArtContext.Provider>
    </AlbumArtSetterContext.Provider>
  );
}
