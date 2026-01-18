import { createContext, useContext, ReactNode, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

interface TvModeContextType {
  isTvMode: boolean;
  detectionReason: string | null;
}

const TvModeContext = createContext<TvModeContextType>({ isTvMode: false, detectionReason: null });

/**
 * Detect if we're running on a TV-like device based on User Agent
 */
function detectTvDevice(): { isTV: boolean; reason: string | null } {
  if (typeof window === 'undefined' || !navigator.userAgent) {
    return { isTV: false, reason: null };
  }
  
  const ua = navigator.userAgent.toLowerCase();
  
  // Chromecast detection
  if (ua.includes('crkey')) {
    return { isTV: true, reason: 'Chromecast' };
  }
  
  // Smart TV platforms
  if (ua.includes('smart-tv') || ua.includes('smarttv')) {
    return { isTV: true, reason: 'Smart TV' };
  }
  
  // Samsung Tizen
  if (ua.includes('tizen') && ua.includes('tv')) {
    return { isTV: true, reason: 'Samsung TV (Tizen)' };
  }
  
  // LG WebOS
  if (ua.includes('webos') && ua.includes('tv')) {
    return { isTV: true, reason: 'LG TV (WebOS)' };
  }
  
  // Android TV
  if (ua.includes('android') && (ua.includes('tv') || ua.includes('aft'))) {
    return { isTV: true, reason: 'Android TV' };
  }
  
  // Amazon Fire TV
  if (ua.includes('aftm') || ua.includes('aftt') || ua.includes('aftb') || ua.includes('firetv')) {
    return { isTV: true, reason: 'Fire TV' };
  }
  
  // Roku
  if (ua.includes('roku')) {
    return { isTV: true, reason: 'Roku' };
  }
  
  // PlayStation/Xbox browsers
  if (ua.includes('playstation') || ua.includes('xbox')) {
    return { isTV: true, reason: 'Game Console' };
  }
  
  // Apple TV (very rare to have browser)
  if (ua.includes('appletv')) {
    return { isTV: true, reason: 'Apple TV' };
  }
  
  // Generic TV detection
  if (ua.includes(' tv ') || ua.includes('_tv_') || ua.includes('-tv-')) {
    return { isTV: true, reason: 'TV (generic)' };
  }
  
  return { isTV: false, reason: null };
}

export function TvModeProvider({ children }: { children: ReactNode }) {
  const [searchParams] = useSearchParams();
  
  const { isTvMode, detectionReason } = useMemo(() => {
    // Manual override via URL param takes priority
    const urlTvMode = searchParams.get('tv');
    if (urlTvMode === 'true') {
      return { isTvMode: true, detectionReason: 'URL parameter (?tv=true)' };
    }
    if (urlTvMode === 'false') {
      return { isTvMode: false, detectionReason: null };
    }
    
    // Auto-detect TV device
    const detection = detectTvDevice();
    if (detection.isTV) {
      console.log(`🖥️ TV-mode auto-enabled: ${detection.reason}`);
      return { isTvMode: true, detectionReason: detection.reason };
    }
    
    return { isTvMode: false, detectionReason: null };
  }, [searchParams]);

  // Log TV mode status for debugging
  if (typeof window !== 'undefined') {
    console.log(`📺 TV Mode: ${isTvMode ? 'ON' : 'OFF'}${detectionReason ? ` (${detectionReason})` : ''}`);
    console.log(`📺 User Agent: ${navigator.userAgent}`);
  }

  return (
    <TvModeContext.Provider value={{ isTvMode, detectionReason }}>
      {children}
      {/* Debug indicator - shows TV mode status */}
      {process.env.NODE_ENV === 'development' || searchParams.get('debug') === 'true' ? (
        <div className="fixed top-2 right-2 z-[200] px-2 py-1 rounded text-xs font-mono bg-black/80 text-white">
          TV: {isTvMode ? `✅ ${detectionReason}` : '❌ OFF'}
        </div>
      ) : null}
    </TvModeContext.Provider>
  );
}

export function useTvMode() {
  return useContext(TvModeContext);
}
