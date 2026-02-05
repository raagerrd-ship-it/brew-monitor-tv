import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RaptControllerDialog } from "./RaptControllerDialog";
import { BrewDeviceLinkDialog } from "./BrewDeviceLinkDialog";
import { BrewCard } from "./brew-card";
import { Logo } from "./Logo";
import { Clock } from "./Clock";
import { SonosWidget } from "./sonos/SonosWidget";
import { DashboardDebugOverlay } from "./DashboardDebugOverlay";
import { TvDebugOverlay } from "./TvDebugOverlay";
import { useEffect, useState, useMemo, useCallback, memo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Settings, Loader2, Pill, AirVent } from "lucide-react";
import { toast as sonnerToast } from "sonner";
import useEmblaCarousel from "embla-carousel-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useVersionCheck } from "@/hooks/use-version-check";
import { useBrewData } from "@/hooks/use-brew-data";
import { useExternalTimer } from "@/hooks/use-external-timer";
import { useExternalUserSettings } from "@/hooks/use-external-user-settings";
import { useMemoryMonitor } from "@/hooks/use-memory-monitor";
import { useAspectRatio } from "@/components/AspectRatioContainer";
import { TIMER_FOOTER_HEIGHT } from "@/components/TimerFooter";
import { TempController } from "@/types/brew";
import { getControllerColor } from "@/lib/brew-utils";
import { supabase } from "@/integrations/supabase/client";
import { useTvMode } from "@/contexts/TvModeContext";

// Fixed header height in pixels (optimized for 720p)
const HEADER_HEIGHT = 56;
export function BrewingDashboard() {
  const [selectedController, setSelectedController] = useState<TempController | null>(null);
  const [selectedControllerIsCooler, setSelectedControllerIsCooler] = useState(false);
  const [controllerDialogOpen, setControllerDialogOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchParams] = useSearchParams();
  const focusedBrewId = searchParams.get('brew');
  const [deviceLinkDialog, setDeviceLinkDialog] = useState<{
    open: boolean;
    brewId: string;
    brewName: string;
    currentControllerId: string | null;
    currentPillId: string | null;
  }>({
    open: false,
    brewId: "",
    brewName: "",
    currentControllerId: null,
    currentPillId: null
  });
  const [albumArtUrl, setAlbumArtUrl] = useState<string | null>(null);
  const [preloadedAlbumArt, setPreloadedAlbumArt] = useState<string | null>(null);
  const preloadTimeoutRef = useRef<number | null>(null);
  
  const handleAlbumArtChange = useCallback((url: string | null) => {
    console.log('[TV Debug] Album art change:', url ? 'loaded' : 'cleared');
    setAlbumArtUrl(url);
    
    // Clear any pending preload
    if (preloadTimeoutRef.current) {
      clearTimeout(preloadTimeoutRef.current);
      preloadTimeoutRef.current = null;
    }
    
    if (!url) {
      setPreloadedAlbumArt(null);
      return;
    }
    
    // Debounce preloading to prevent rapid image switches
    preloadTimeoutRef.current = window.setTimeout(() => {
      const img = new Image();
      img.onload = () => {
        console.log('[TV Debug] Album art preloaded successfully');
        setPreloadedAlbumArt(url);
      };
      img.onerror = () => {
        console.log('[TV Debug] Album art preload failed');
        setPreloadedAlbumArt(null);
      };
      img.src = url;
    }, 100);
  }, []);
  
  // Cleanup preload timeout on unmount
  useEffect(() => {
    return () => {
      if (preloadTimeoutRef.current) {
        clearTimeout(preloadTimeoutRef.current);
      }
    };
  }, []);
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { isTvMode } = useTvMode();
  const showDebug = false; // Debug disabled for TV performance
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
    loadBrewEvents
  } = useBrewData();

  // External timer for footer padding
  const externalTimer = useExternalTimer();

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

  // Check for new app versions every 60 seconds
  const {
    appLoadTime
  } = useVersionCheck(60000);

  // Monitor memory usage in TV mode - reload if above 90%
  useMemoryMonitor(90, 30000, isTvMode);

  // Debug log for TV mode
  useEffect(() => {
    if (isTvMode) {
      console.log('[TV Debug] Dashboard mounted in TV mode');
      console.log('[TV Debug] Brews:', brews.length, 'Controllers:', controllers.length);
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
  const handleDeviceLinkOpen = useCallback((brewId: string, brewName: string, controllerId: string | null, pillId: string | null) => {
    setDeviceLinkDialog({
      open: true,
      brewId,
      brewName,
      currentControllerId: controllerId,
      currentPillId: pillId
    });
  }, []);
  const handleControllerClick = useCallback((controller: TempController) => {
    setSelectedController(controller);
    setSelectedControllerIsCooler(coolerControllerId === controller.controller_id);
    setControllerDialogOpen(true);
  }, [coolerControllerId]);

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

  // Loading state - AFTER all hooks
  if (loading) {
    return <div className="min-h-screen w-full bg-background flex items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>;
  }

  // Show timer footer based on setting
  const showTimerFooter = externalTimer.isActive && (timerTvModeOnly ? isTvMode : true);
  // Mobile header height - logo row (~44px) + controller bar (~48px) + padding (24px) + gaps (12px)
  const MOBILE_HEADER_HEIGHT = controllers.length > 0 ? 136 : 72;
  
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
      return actualContainerHeight - HEADER_HEIGHT - footerSpace;
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
  
  return <div className={`w-full relative ${isMobile ? '' : 'flex flex-col overflow-hidden'}`} style={{
    height: getContainerHeight(),
    background: albumArtUrl && isTvMode ? 'transparent' : 'hsl(var(--background))'
  }}>
      {/* Debug overlay - only in TV mode */}
      {showDebug && isTvMode && (
        <TvDebugOverlay />
      )}
      
      {/* Album art background - uses preloaded image for stability */}
      {isTvMode && preloadedAlbumArt && (
        <div 
          className="absolute inset-0 pointer-events-none"
          style={{ 
            backgroundImage: `url(${preloadedAlbumArt})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center center',
            opacity: 0.2,
            contain: 'strict',
          }}
        />
      )}
      {/* Version indicator */}
      

      {/* Header Bar */}
      <div 
        className={`overflow-visible z-20 transition-all duration-500 ${isMobile ? 'flex flex-col py-3 px-3 gap-3 fixed top-0 left-0 right-0' : 'flex-shrink-0 flex items-center justify-between px-6 gap-6 relative'}`} 
        style={{
          height: isMobile ? 'auto' : albumArtUrl && isTvMode ? 'auto' : `${HEADER_HEIGHT}px`,
          background: albumArtUrl && isTvMode 
            ? 'hsl(222 20% 9% / 0.7)' 
            : 'hsl(222 20% 9%)',
          backdropFilter: albumArtUrl && isTvMode ? 'blur(12px)' : undefined,
          borderBottom: '1px solid hsl(222 15% 16%)'
        }}
      >
        {/* Subtle top highlight - desktop only */}
        {!isMobile && <div className="absolute inset-x-0 top-0 h-px" style={{
        background: 'linear-gradient(90deg, transparent 0%, hsl(222 15% 25%) 20%, hsl(222 15% 25%) 80%, transparent 100%)'
      }} />}
        
        {/* Mobile: Logo row with settings */}
        {isMobile ? <div className="flex items-center justify-between w-full">
            <Logo />
            <div className="relative flex items-center justify-center" style={{
          width: '36px',
          height: '36px'
        }}>
              <Button variant="ghost" size="icon" onClick={() => navigate('/settings')} className="opacity-40 hover:opacity-100 hover:bg-transparent transition-opacity duration-200 w-full h-full rounded-full">
                <Settings className="w-5 h-5" />
              </Button>
            </div>
          </div> : null}
        
        {/* RAPT Section - Mobile */}
        {isMobile && controllers.length > 0 && <RaptControllerBar controllers={controllers} pills={pills} onControllerClick={handleControllerClick} isMobile={true} isTvMode={isTvMode} />}
        
        {/* Desktop: Three-column layout */}
        {!isMobile && <>
            <div className="flex items-center flex-shrink-0">
              <Logo />
            </div>
            
            <div className="flex-1 flex items-center justify-center">
              {controllers.length > 0 && <RaptControllerBar controllers={controllers} pills={pills} onControllerClick={handleControllerClick} isMobile={false} isTvMode={isTvMode} />}
            </div>
            
            <div className="flex items-center gap-4 flex-shrink-0">
              <Clock />
              
              {!isTvMode && <div className="relative flex items-center justify-center" style={{
            width: '40px',
            height: '40px'
          }}>
                  <Button variant="ghost" size="icon" onClick={() => navigate('/settings')} className="opacity-40 hover:opacity-100 hover:bg-transparent transition-opacity duration-200 w-full h-full rounded-full">
                    <Settings className="transition-colors duration-200" style={{
                width: '50%',
                height: '50%'
              }} />
                  </Button>
                </div>}
            </div>
          </>}
      </div>

      {/* Main Display Area */}
      <div className={`relative flex flex-col z-0 ${isMobile ? 'h-full overflow-auto' : 'flex-1 overflow-hidden'}`} style={isMobile ? { paddingTop: `${MOBILE_HEADER_HEIGHT}px` } : undefined}>
        {brews.length === 0 ? <div className="flex items-center justify-center h-full p-4">
            <Card className="max-w-2xl w-full p-8 text-center">
              <h2 className="text-2xl font-bold mb-4">Inga öl valda</h2>
              <p className="text-muted-foreground mb-6">
                Gå till inställningar för att välja vilka öl du vill visa på dashboarden
              </p>
              <Button onClick={() => navigate('/settings')}>
                <Settings className="mr-2 h-4 w-4" />
                Öppna Inställningar
              </Button>
            </Card>
          </div> : isMobile ? <div className="flex flex-col flex-1">
            {brews.length > 1 && <div className="relative py-2 flex-shrink-0">
                <div className="flex justify-center gap-2">
                  {brews.map((_, index) => <button key={index} onClick={() => emblaApi?.scrollTo(index)} className={`h-2 rounded-full transition-all duration-300 ${index === selectedIndex ? 'w-8 bg-primary' : 'w-2 bg-muted-foreground/30'}`} aria-label={`Gå till öl ${index + 1}`} />)}
                </div>
              </div>}
            
            <div className="flex-1 overflow-hidden px-3 pb-2" ref={emblaRef}>
              <div className="flex h-full">
                {brews.map((brew, index) => <div key={brew.id} className="flex-[0_0_100%] min-w-0 px-3">
                    <BrewCard brew={brew} updatedFields={updatedFields} isAuthenticated={isAuthenticated} pills={pills} controllers={controllers} onShareBrew={handleShareBrew} onEventsChange={loadBrewEvents} onDeviceLinkOpen={handleDeviceLinkOpen} isTvMode={isTvMode} cardIndex={index} hasAlbumArtBackground={!!albumArtUrl && isTvMode} />
                  </div>)}
              </div>
            </div>
          </div> : <div 
            className={`${gridLayout} w-full px-4 py-2`} 
            style={{ 
              height: isAspectRatioLocked ? `${getContentHeight()}px` : `calc(100vh - ${HEADER_HEIGHT}px${showTimerFooter ? ` - ${TIMER_FOOTER_HEIGHT}px` : ''})`,
            }}
          >
            {brews.map((brew, index) => <div 
              key={brew.id} 
              className={cardWidthClass}
              style={{ 
                height: isAspectRatioLocked ? `${getCardHeight()}px` : `calc(100% - 16px)`,
              }}
            >
                <BrewCard brew={brew} updatedFields={updatedFields} isAuthenticated={isAuthenticated} pills={pills} controllers={controllers} onShareBrew={handleShareBrew} onEventsChange={loadBrewEvents} onDeviceLinkOpen={handleDeviceLinkOpen} isTvMode={isTvMode} cardIndex={index} hasAlbumArtBackground={!!albumArtUrl && isTvMode} />
              </div>)}
          </div>}
      </div>

      {/* Floating Sonos widget - positioned top-right over brew cards in TV mode */}
      {isTvMode && (
        <div 
          className="absolute z-10"
          style={{
            top: `${HEADER_HEIGHT + 16}px`,
            right: '24px',
          }}
        >
          <SonosWidget isMobile={false} isTvMode={true} onAlbumArtChange={handleAlbumArtChange} />
        </div>
      )}

      {/* Dialogs */}
      {selectedController && <RaptControllerDialog controller={selectedController} open={controllerDialogOpen} onOpenChange={setControllerDialogOpen} isCooler={selectedControllerIsCooler} />}

      <BrewDeviceLinkDialog open={deviceLinkDialog.open} onOpenChange={open => setDeviceLinkDialog(prev => ({
      ...prev,
      open
    }))} brewId={deviceLinkDialog.brewId} onUpdate={() => {}} brewName={deviceLinkDialog.brewName} currentControllerId={deviceLinkDialog.currentControllerId} currentPillId={deviceLinkDialog.currentPillId} controllers={controllers} pills={pills} />
    </div>;
}

// Extracted sub-components for better organization

interface RaptControllerBarProps {
  controllers: TempController[];
  pills: {
    pill_id: string;
    color: string;
    name: string;
    battery_level: number;
    last_update: string | null;
  }[];
  onControllerClick: (controller: TempController) => void;
  isMobile: boolean;
  isTvMode?: boolean;
}
const RaptControllerBar = memo(function RaptControllerBar({
  controllers,
  pills,
  onControllerClick,
  isMobile,
  isTvMode = false
}: RaptControllerBarProps) {
  return <div className={isMobile ? "flex items-center justify-center w-full" : ""}>
      <div className={`flex items-center rounded-lg ${isMobile ? 'gap-1 px-2 py-2' : 'gap-2 px-3 py-1'} overflow-x-auto scrollbar-hide`} style={{
      background: 'hsl(222 20% 11%)',
      border: '1px solid hsl(222 15% 18%)',
      boxShadow: '0 6px 20px hsl(222 30% 3% / 0.6), 0 3px 8px hsl(222 30% 3% / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.04)'
    }}>
        {controllers.map((controller, index) => {
        const controllerColor = getControllerColor(controller.name);
        const linkedPill = pills.find(p => p.pill_id === controller.linked_pill_id);
        const isPillStale = linkedPill?.last_update ? (new Date().getTime() - new Date(linkedPill.last_update).getTime()) / (1000 * 60 * 60) > 24 : true;
        return <div key={controller.id} className="flex items-center">
              {index > 0 && <div className={`${isMobile ? 'h-6 mx-1' : 'h-8 mx-2'} w-px`} style={{
            background: 'hsl(222 15% 20%)'
          }} />}
              
              <div className={`flex items-center flex-shrink-0 rounded ${isMobile ? 'px-2 py-1 gap-2' : 'px-3 py-1 gap-3'} ${isTvMode ? '' : 'cursor-pointer transition-all duration-200'}`} style={{
            background: 'transparent'
          }} onClick={isTvMode ? undefined : () => onControllerClick(controller)} onMouseEnter={!isMobile && !isTvMode ? e => {
            e.currentTarget.style.background = 'hsl(222 18% 15%)';
          } : undefined} onMouseLeave={!isMobile && !isTvMode ? e => {
            e.currentTarget.style.background = 'transparent';
          } : undefined} title={!isMobile && !isTvMode ? `${controller.name}\nInbyggd: ${controller.current_temp !== null ? controller.current_temp.toFixed(1) : '--'}°C${controller.pill_temp !== null ? `\nPill: ${controller.pill_temp.toFixed(1)}°C` : ''}\nMål: ${controller.target_temp !== null ? controller.target_temp.toFixed(1) : '--'}°C\n\nKlicka för att ändra inställningar` : undefined}>
                <AirVent style={{
              width: isMobile ? '1rem' : isTvMode ? '1rem' : '1.25rem',
              height: isMobile ? '1rem' : isTvMode ? '1rem' : '1.25rem',
              color: controllerColor,
              flexShrink: 0,
              opacity: 0.7
            }} />
                
                <span className={`font-semibold tabular-nums whitespace-nowrap ${isMobile ? 'text-sm' : ''}`} style={{
              fontSize: isMobile ? undefined : isTvMode ? '16px' : '24px',
              color: linkedPill?.color || 'hsl(var(--foreground))'
            }}>
                  {controller.current_temp !== null ? `${controller.current_temp.toFixed(1)}°C` : '--°C'}
                </span>
                
                {linkedPill && <div className={`flex items-center gap-1 transition-opacity ${isPillStale ? 'opacity-40' : isMobile ? 'opacity-60' : ''}`} title={!isMobile ? `${linkedPill.name}\nBatteri: ${linkedPill.battery_level}%${isPillStale ? '\n⚠️ Ingen uppdatering på >24h' : ''}` : undefined}>
                    <div className="relative flex items-center">
                      <Pill style={{
                  width: isMobile ? '0.7rem' : isTvMode ? '0.7rem' : '1rem',
                  height: isMobile ? '0.7rem' : isTvMode ? '0.7rem' : '1rem',
                  flexShrink: 0
                }} color={linkedPill.color} strokeWidth={2} className={isPillStale && !isMobile && !isTvMode ? 'animate-pulse' : ''} />
                      {isPillStale && !isMobile && !isTvMode && <div className="absolute -top-0.5 -right-0.5 rounded-full w-1.5 h-1.5" style={{
                  backgroundColor: 'hsl(25 95% 53%)'
                }} />}
                    </div>
                    <span className={`font-semibold tabular-nums whitespace-nowrap ${isMobile ? 'text-[10px]' : ''}`} style={{
                fontSize: isMobile ? undefined : isTvMode ? '14px' : '20px',
                color: linkedPill.color
              }}>
                      {linkedPill.battery_level}%
                    </span>
                  </div>}
              </div>
            </div>;
      })}
      </div>
    </div>;
});