import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RaptControllerDialog } from "./RaptControllerDialog";

import { BrewCard } from "./brew-card";
import { DashboardHeader, HEADER_HEIGHT, HEADER_HEIGHT_TV } from "./DashboardHeader";
import { SonosWidget } from "./sonos/SonosWidget";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Logo } from "./Logo";
import dbLogo from "@/assets/db-logo.png";
import { Settings, Loader2 } from "lucide-react";
import { toast as sonnerToast } from "sonner";
import useEmblaCarousel from "embla-carousel-react";
import { useIsMobile } from "@/hooks/use-mobile";

import { useBrewData } from "@/hooks/use-brew-data";
import { useExternalTimer } from "@/hooks/use-external-timer";
import { useExternalUserSettings } from "@/hooks/use-external-user-settings";

import { useAspectRatio } from "@/components/AspectRatioContainer";
import { TimerFooter, TIMER_FOOTER_HEIGHT } from "@/components/TimerFooter";
import { TempController } from "@/types/brew";

import { supabase } from "@/integrations/supabase/client";
import { useTvMode } from "@/contexts/TvModeContext";

// Header height imported from DashboardHeader
export function BrewingDashboard() {
  const [selectedController, setSelectedController] = useState<TempController | null>(null);
  const [selectedControllerIsCooler, setSelectedControllerIsCooler] = useState(false);
  const [controllerDialogOpen, setControllerDialogOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchParams] = useSearchParams();
  const focusedBrewId = searchParams.get('brew');
  const [visibleBgUrl, setVisibleBgUrl] = useState<string | null>(null);
  const visibleBgBaseRef = useRef<string | null>(null); // URL without query params
  const preloadingUrlRef = useRef<string | null>(null);
  
  
  // Preload background image before showing to prevent black flashes
  const handleAlbumArtChange = useCallback((url: string | null) => {
    if (!url) {
      setVisibleBgUrl(null);
      visibleBgBaseRef.current = null;
      preloadingUrlRef.current = null;
      return;
    }
    const baseUrl = url.split('?')[0];
    // Skip if same base URL (ignore cache-bust query params)
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



  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { isTvMode } = useTvMode();
  
  // Get aspect ratio context to determine sizing strategy
  // In TV mode, height will be actual viewport height, not reference 1080
  const { isLocked: isAspectRatioLocked, height: containerHeight, width: containerWidth } = useAspectRatio();

  // Only use carousel on mobile and not in TV mode - skip embla overhead in TV mode
  const shouldUseCarousel = isMobile && !isTvMode;
  const [emblaRef, emblaApi] = useEmblaCarousel(shouldUseCarousel ? {
    loop: false,
    align: "center"
  } : undefined);

  // Use the optimized brew data hook
  const {
    brews,
    pills,
    controllers,
    loading,
    updatedFields,
    isAuthenticated,
    loadBrewEvents,
    loadBrews,
    loadRaptData,
    onSonosNowPlayingChange,
    onSonosSettingsChange,
    onSyncSettingsChange,
    onCachedTimerChange,
  } = useBrewData();

  // External timer for footer padding
  const externalTimer = useExternalTimer(onCachedTimerChange);

  // External user settings (stored in database per user)
  const {
    timerTvModeOnly
  } = useExternalUserSettings();

  // Track cooler controller ID
  const [coolerControllerId, setCoolerControllerId] = useState<string | null>(null);
  
  useEffect(() => {
    const loadCoolerController = async () => {
      const { data } = await supabase
        .from('auto_cooling_settings')
        .select('cooler_controller_id')
        .limit(1)
        .maybeSingle();
      
      if (data?.cooler_controller_id) {
        setCoolerControllerId(data.cooler_controller_id);
      }
    };
    
    loadCoolerController();
  }, []);

  const appLoadTime = useMemo(() => new Date(), []);


  // Wire up consolidated realtime callbacks
  const lastKnownRefreshAt = useRef<string | null>(null);
  

  // TV force refresh via consolidated channel + polling fallback
  useEffect(() => {
    if (!isTvMode) return;

    // Initialize with current value from DB
    supabase.from('sync_settings').select('force_tv_refresh_at').limit(1).maybeSingle().then(({ data }) => {
      lastKnownRefreshAt.current = data?.force_tv_refresh_at ?? null;
    });

    const triggerRefresh = (newVal: string) => {
      console.log('[TV] Remote refresh triggered');
      lastKnownRefreshAt.current = newVal;
      setTimeout(async () => {
        if ('caches' in window) {
          const names = await caches.keys();
          await Promise.all(names.map(n => caches.delete(n)));
        }
        const params = new URLSearchParams(window.location.search);
        params.set('v', Date.now().toString());
        window.location.href = window.location.origin + window.location.pathname + '?' + params.toString();
      }, 500);
    };

    // Realtime callback
    onSyncSettingsChange.current = (payload: any) => {
      const newVal = payload.new?.force_tv_refresh_at;
      if (newVal && newVal !== lastKnownRefreshAt.current) {
        triggerRefresh(newVal);
      }
    };

    // Polling fallback every 30s in case realtime drops
    const pollInterval = setInterval(async () => {
      try {
        const { data } = await supabase
          .from('sync_settings')
          .select('force_tv_refresh_at')
          .limit(1)
          .maybeSingle();
        const newVal = data?.force_tv_refresh_at;
        if (newVal && newVal !== lastKnownRefreshAt.current) {
          triggerRefresh(newVal);
        }
      } catch {
        // Ignore polling errors
      }
    }, 30000);

    return () => {
      onSyncSettingsChange.current = null;
      clearInterval(pollInterval);
    };
  }, [isTvMode, onSyncSettingsChange]);

  // Force overflow hidden on body in TV mode (Chromecast iframe)
  useEffect(() => {
    if (isTvMode) {
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      console.log('[TV Debug] Dashboard mounted in TV mode');
      console.log('[TV Debug] Brews:', brews.length, 'Controllers:', controllers.length);
      return () => {
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
      };
    }
  }, [isTvMode, brews.length, controllers.length]);

  // Scroll to focused brew when URL param is present (only on mobile with carousel)
  useEffect(() => {
    if (!focusedBrewId || !emblaApi || !shouldUseCarousel || brews.length === 0) return;
    let brewIndex = brews.findIndex(b => b.batch_id === focusedBrewId);
    if (brewIndex === -1) {
      brewIndex = brews.findIndex(b => {
        const brewSlug = b.name.toLowerCase().replace(/[åä]/g, 'a').replace(/ö/g, 'o').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        return brewSlug === focusedBrewId;
      });
    }
    if (brewIndex !== -1) {
      emblaApi.scrollTo(brewIndex);
      sonnerToast(`${brews[brewIndex].name} är i fokus`, {
        description: "Detta öl delades med dig",
        duration: 3000
      });
    }
  }, [focusedBrewId, emblaApi, brews, shouldUseCarousel]);

  // Embla carousel selection handler (only when carousel is active)
  useEffect(() => {
    if (!emblaApi || !shouldUseCarousel) return;
    const onSelect = () => {
      setSelectedIndex(emblaApi.selectedScrollSnap());
    };
    emblaApi.on("select", onSelect);
    onSelect();
    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi, shouldUseCarousel]);

  // Memoized handlers - MUST be before any conditional returns
  const handleShareBrew = useCallback(async (brew: typeof brews[0]) => {
    // Use short share_id for cleaner QR codes, fallback to batch_id
    const shareId = brew.share_id || brew.batch_id;
    const shareUrl = `https://brew-monitor-tv.lovable.app/brew/${encodeURIComponent(shareId)}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      sonnerToast(`${brew.name} delad!`, {
        description: "Länken har kopierats till urklipp",
        duration: 3000
      });
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }, []);
  const handleControllerClick = useCallback((controller: TempController) => {
    setSelectedController(controller);
    setSelectedControllerIsCooler(coolerControllerId === controller.controller_id);
    setControllerDialogOpen(true);
  }, [coolerControllerId]);
  const handleManualRefresh = useCallback(async () => {
    sonnerToast("Uppdaterar...", { duration: 1500 });
    await Promise.all([loadBrews(), loadRaptData()]);
    sonnerToast.success("Data uppdaterad", { duration: 1500 });
  }, [loadBrews, loadRaptData]);

  // Memoized grid layout helpers - MUST be before any conditional returns
  const gridLayout = useMemo(() => {
    const count = brews.length;
    if (count === 3) return "flex justify-center gap-6";
    return "flex flex-wrap justify-center gap-6";
  }, [brews.length]);
  const cardWidthClass = useMemo(() => {
    const count = brews.length;
    if (count === 3) return "flex-1 min-w-0";
    return "w-[calc(50%-0.75rem)]";
  }, [brews.length]);

  // Memoize formatted load time
  const formattedLoadTime = useMemo(() => appLoadTime.toLocaleString('sv-SE', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }), [appLoadTime]);

  // Minimum splash time (2s) so logo is always visible
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);
  const [contentPainted, setContentPainted] = useState(false);
  const showSplash = !minTimeElapsed || !contentPainted;
  
  useEffect(() => {
    const timer = setTimeout(() => setMinTimeElapsed(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  // Once data is loaded, wait for two animation frames (render + paint) then mark ready
  useEffect(() => {
    if (!loading) {
      let cancelled = false;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!cancelled) setContentPainted(true);
        });
      });
      return () => { cancelled = true; };
    }
  }, [loading]);

  // Show timer footer based on setting
  const showTimerFooter = externalTimer.isActive && (timerTvModeOnly ? isTvMode : true);
  // Mobile header height - logo row (~44px) + controller bar (~48px) + padding (24px) + gaps (12px)
  const MOBILE_HEADER_HEIGHT = controllers.length > 0 ? 136 : 72;
  const activeHeaderHeight = isTvMode ? HEADER_HEIGHT_TV : HEADER_HEIGHT;
  
  // Use actual container height from context (viewport in TV mode, 1080 in desktop preview)
  const actualContainerHeight = containerHeight;
  
  // Calculate container height - always use full reference height, footer is positioned absolutely
  const getContainerHeight = () => {
    if (isAspectRatioLocked) {
      return `${actualContainerHeight}px`;
    }
    return showTimerFooter ? `calc(100vh - ${TIMER_FOOTER_HEIGHT}px)` : '100vh';
  };
  
  // Calculate content area height for brew cards (subtract footer space when active)
  const CONTENT_PADDING = 16; // 8px top + 8px bottom
  const getContentHeight = () => {
    if (isAspectRatioLocked) {
      const footerSpace = showTimerFooter ? TIMER_FOOTER_HEIGHT : 0;
      return actualContainerHeight - activeHeaderHeight - footerSpace;
    }
    return null; // Use CSS calc for non-locked mode
  };
  
  const getCardHeight = () => {
    if (isAspectRatioLocked) {
      const contentHeight = getContentHeight();
      return contentHeight ? contentHeight - CONTENT_PADDING : null;
    }
    return null;
  };
  
  return <>
    {/* Splash overlay - covers content until fully painted */}
    {showSplash && (
      <div className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center gap-4 animate-in fade-in duration-500">
        <img src={dbLogo} alt="Bryggövervakare" className="max-h-[60vh] w-auto object-contain" />
        <Loader2 className="h-8 w-8 animate-spin text-primary/40" />
      </div>
    )}
    <div className={`w-full relative ${isMobile ? '' : 'flex flex-col overflow-hidden'}`} style={{
    height: getContainerHeight(),
    background: 'transparent'
  }}>
      
      {/* Album art background - blur applied server-side, brightness via overlay */}
      {visibleBgUrl && (
        <>
          <div 
            className="absolute inset-0 pointer-events-none"
            style={{ 
              backgroundImage: `url(${visibleBgUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center center',
            }}
          />
        </>
      )}

      {/* Header Bar */}
      <DashboardHeader
        controllers={controllers}
        pills={pills}
        onControllerClick={handleControllerClick}
        hasAlbumArtBackground={!!visibleBgUrl}
        onRefresh={isMobile ? handleManualRefresh : undefined}
        sonosSlot={(!isMobile || isTvMode) ? (
          <SonosWidget isMobile={false} isTvMode={isTvMode} variant="header" onAlbumArtChange={handleAlbumArtChange} onRealtimeRef={onSonosNowPlayingChange} />
        ) : undefined}
      />

      {/* Main Display Area */}
      <div className={`relative flex flex-col z-0 ${isMobile ? 'h-full overflow-auto' : 'flex-1 overflow-visible'}`} style={isMobile ? { paddingTop: `${MOBILE_HEADER_HEIGHT}px` } : undefined}>
        {brews.length === 0 ? <div className="flex items-center justify-center h-full p-4">
            <div className="max-w-2xl w-full p-8 text-center rounded-xl" style={{
              background: 'linear-gradient(145deg, hsl(222 20% 14% / 0.7) 0%, hsl(222 20% 12% / 0.7) 100%)',
              border: '1px solid hsl(222 15% 25% / 0.4)',
              boxShadow: '0 8px 24px hsl(222 30% 3% / 0.5), 0 4px 10px hsl(222 30% 3% / 0.3), inset 0 1px 0 hsl(0 0% 100% / 0.08)',
              backdropFilter: 'blur(20px)',
            }}>
              <h2 className="text-2xl font-bold mb-4">Inga öl valda</h2>
              <p className="text-muted-foreground mb-6">
                Gå till inställningar för att välja vilka öl du vill visa på dashboarden
              </p>
              <Button onClick={() => navigate('/settings')}>
                <Settings className="mr-2 h-4 w-4" />
                Öppna Inställningar
              </Button>
            </div>
          </div> : isMobile ? <div className="flex flex-col flex-1">
            {brews.length > 1 && <div className="relative py-2 flex-shrink-0">
                <div className="flex justify-center gap-2">
                  {brews.map((_, index) => <button key={index} onClick={() => emblaApi?.scrollTo(index)} className={`h-2 rounded-full transition-all duration-300 ${index === selectedIndex ? 'w-8 bg-primary' : 'w-2 bg-muted-foreground/30'}`} aria-label={`Gå till öl ${index + 1}`} />)}
                </div>
              </div>}
            
            <div className="flex-1 overflow-hidden px-3 pb-2" ref={emblaRef}>
              <div className="flex h-full">
                {brews.map((brew, index) => <div key={brew.id} className="flex-[0_0_100%] min-w-0 px-3">
                    <BrewCard brew={brew} updatedFields={updatedFields} isAuthenticated={isAuthenticated} pills={pills} controllers={controllers} onShareBrew={handleShareBrew} onEventsChange={loadBrewEvents} onControllerClick={handleControllerClick} cardIndex={index} hasAlbumArtBackground={!!visibleBgUrl} brewCount={brews.length} />
                  </div>)}
              </div>
            </div>
          </div> : <div 
            className={`${gridLayout} w-full px-4 py-2`} 
            style={{ 
              height: isAspectRatioLocked ? `${getContentHeight()}px` : `calc(100vh - ${activeHeaderHeight}px${showTimerFooter ? ` - ${TIMER_FOOTER_HEIGHT}px` : ''})`,
            }}
          >
            {brews.map((brew, index) => <div 
              key={brew.id} 
              className={cardWidthClass}
              style={{ 
                height: isAspectRatioLocked ? `${getCardHeight()}px` : `calc(100% - 16px)`,
              }}
            >
                <BrewCard brew={brew} updatedFields={updatedFields} isAuthenticated={isAuthenticated} pills={pills} controllers={controllers} onShareBrew={handleShareBrew} onEventsChange={loadBrewEvents} onControllerClick={handleControllerClick} cardIndex={index} hasAlbumArtBackground={!!visibleBgUrl} brewCount={brews.length} />
              </div>)}
          </div>}
      </div>



      {/* Dialogs */}
      {selectedController && <RaptControllerDialog controller={selectedController} open={controllerDialogOpen} onOpenChange={setControllerDialogOpen} isCooler={selectedControllerIsCooler} />}

      {/* Timer Footer - rendered here to share hook data instead of duplicating */}
      <TimerFooter timer={externalTimer} timerTvModeOnly={timerTvModeOnly} />
    </div>
  </>;
}
