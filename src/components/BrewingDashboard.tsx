import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RaptControllerDialog } from "./RaptControllerDialog";
import { BrewDeviceLinkDialog } from "./BrewDeviceLinkDialog";
import { BrewCard } from "./brew-card";
import { DashboardHeader, HEADER_HEIGHT } from "./DashboardHeader";
import { SonosWidget } from "./sonos/SonosWidget";
import { useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Settings, Loader2 } from "lucide-react";
import { toast as sonnerToast } from "sonner";
import useEmblaCarousel from "embla-carousel-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useVersionCheck } from "@/hooks/use-version-check";
import { useBrewData } from "@/hooks/use-brew-data";
import { useExternalTimer } from "@/hooks/use-external-timer";
import { useExternalUserSettings } from "@/hooks/use-external-user-settings";

import { useAspectRatio } from "@/components/AspectRatioContainer";
import { TIMER_FOOTER_HEIGHT } from "@/components/TimerFooter";
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
  const [processedBgUrl, setProcessedBgUrl] = useState<string | null>(null);
  
  // Simple: the widget already loaded the image, just use the URL directly
  const handleAlbumArtChange = useCallback((url: string | null) => {
    setAlbumArtUrl(url);
  }, []);
  const handleBackgroundUrlChange = useCallback((url: string | null) => {
    setProcessedBgUrl(url);
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

  // Check for new app versions - 5 min in TV mode to reduce CPU, 60s otherwise
  const {
    appLoadTime
  } = useVersionCheck(isTvMode ? 300000 : 60000);


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
      
      {/* Album art background - uses server-processed image (blur+darken baked in) */}
      {isTvMode && processedBgUrl && (
        <div 
          className="absolute inset-0 pointer-events-none"
          style={{ 
            backgroundImage: `url(${processedBgUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center center',
            contain: 'strict',
          }}
        />
      )}
      {/* Fallback: unprocessed album art with opacity while waiting for processed version */}
      {isTvMode && albumArtUrl && !processedBgUrl && (
        <div 
          className="absolute inset-0 pointer-events-none"
          style={{ 
            backgroundImage: `url(${albumArtUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center center',
            opacity: 0.2,
            contain: 'strict',
          }}
        />
      )}
      {/* Version indicator */}
      

      {/* Header Bar */}
      <DashboardHeader
        controllers={controllers}
        pills={pills}
        onControllerClick={handleControllerClick}
        hasAlbumArtBackground={!!albumArtUrl && isTvMode}
      />

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
          <SonosWidget isMobile={false} isTvMode={true} onAlbumArtChange={handleAlbumArtChange} onBackgroundUrlChange={handleBackgroundUrlChange} />
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
