import { Button } from "@/components/ui/button";
import { RaptControllerDialog } from "./RaptControllerDialog";
import { BrewCard } from "./brew-card";
import { BrewCardSkeleton } from "./brew-card/BrewCardSkeleton";
import { DashboardHeader, HEADER_HEIGHT, HEADER_HEIGHT_TV } from "./DashboardHeader";
import { SonosWidget } from "./sonos/SonosWidget";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import dbLogo from "@/assets/db-logo.png";
import { Settings, Loader2, Beer } from "lucide-react";
import { toast as sonnerToast } from "sonner";

import { useBrewData } from "@/hooks/use-brew-data";
import { useExternalTimer } from "@/hooks/use-external-timer";
import { useExternalUserSettings } from "@/hooks/use-external-user-settings";
import { useSplashScreen } from "@/hooks/use-splash-screen";
import { useBrewCarousel } from "@/hooks/use-brew-carousel";
import { useAlbumArtBackground } from "@/hooks/use-album-art-background";
import { useTvRefresh } from "@/hooks/use-tv-refresh";

import { useAspectRatio } from "@/components/AspectRatioContainer";
import { TimerFooter, TIMER_FOOTER_HEIGHT } from "@/components/TimerFooter";
import { TempController } from "@/types/brew";

import { supabase } from "@/integrations/supabase/client";

export function BrewingDashboard() {
  const [selectedController, setSelectedController] = useState<TempController | null>(null);
  const [selectedControllerIsCooler, setSelectedControllerIsCooler] = useState(false);
  const [controllerDialogOpen, setControllerDialogOpen] = useState(false);

  const navigate = useNavigate();
  const { isLocked: isAspectRatioLocked, height: containerHeight } = useAspectRatio();

  // Use the optimized brew data hook
  const {
    brews, pills, controllers, loading, updatedFields, isAuthenticated,
    loadBrewEvents, loadBrews, loadRaptData,
    onSonosNowPlayingChange, onSonosSettingsChange, onSyncSettingsChange, onCachedTimerChange,
  } = useBrewData();

  // Extracted hooks
  const { visibleBgUrl, handleAlbumArtChange } = useAlbumArtBackground();
  const { emblaRef, emblaApi, selectedIndex, shouldUseCarousel, isMobile, isTvMode } = useBrewCarousel(brews);
  const { showSplash } = useSplashScreen(loading);
  useTvRefresh(isTvMode, onSyncSettingsChange);

  // External timer & settings
  const externalTimer = useExternalTimer(onCachedTimerChange);
  const { timerTvModeOnly } = useExternalUserSettings();

  // Track cooler controller ID
  const [coolerControllerId, setCoolerControllerId] = useState<string | null>(null);
  useEffect(() => {
    const loadCoolerController = async () => {
      const { data } = await supabase
        .from('auto_cooling_settings')
        .select('cooler_controller_id')
        .limit(1)
        .maybeSingle();
      if (data?.cooler_controller_id) setCoolerControllerId(data.cooler_controller_id);
    };
    loadCoolerController();
  }, []);

  const appLoadTime = useMemo(() => new Date(), []);

  // Force overflow hidden on body in TV mode
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

  // Memoized handlers
  const handleShareBrew = useCallback(async (brew: typeof brews[0]) => {
    const shareId = brew.share_id || brew.batch_id;
    const shareUrl = `https://brew-monitor-tv.lovable.app/brew/${encodeURIComponent(shareId)}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      sonnerToast(`${brew.name} delad!`, { description: "Länken har kopierats till urklipp", duration: 3000 });
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

  // Memoized grid layout helpers
  const gridLayout = useMemo(() => {
    return brews.length === 3 ? "flex justify-center gap-6" : "flex flex-wrap justify-center gap-6";
  }, [brews.length]);

  const cardWidthClass = useMemo(() => {
    return brews.length === 3 ? "flex-1 min-w-0" : "w-[calc(50%-0.75rem)]";
  }, [brews.length]);

  // Layout calculations
  const showTimerFooter = externalTimer.isActive && (timerTvModeOnly ? isTvMode : true);
  const MOBILE_HEADER_HEIGHT = controllers.length > 0 ? 112 : 56;
  const activeHeaderHeight = isTvMode ? HEADER_HEIGHT_TV : HEADER_HEIGHT;
  const CONTENT_PADDING = 16;

  const getContainerHeight = () => {
    if (isAspectRatioLocked) return `${containerHeight}px`;
    return showTimerFooter ? `calc(100vh - ${TIMER_FOOTER_HEIGHT}px)` : '100vh';
  };

  const getContentHeight = () => {
    if (isAspectRatioLocked) {
      const footerSpace = showTimerFooter ? TIMER_FOOTER_HEIGHT : 0;
      return containerHeight - activeHeaderHeight - footerSpace;
    }
    return null;
  };

  const getCardHeight = () => {
    if (isAspectRatioLocked) {
      const contentHeight = getContentHeight();
      return contentHeight ? contentHeight - CONTENT_PADDING : null;
    }
    return null;
  };

  return <>
    {/* Splash overlay */}
    <div
      className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center gap-4 pointer-events-none"
      style={{
        opacity: showSplash ? 1 : 0,
        transition: 'opacity 0.5s ease-out',
        ...(showSplash ? {} : { visibility: 'hidden' as const, transitionProperty: 'opacity, visibility', transitionDelay: '0s, 0.5s' }),
      }}
    >
      <img src={dbLogo} alt="Bryggövervakare" className="max-h-[60vh] w-auto object-contain invert" />
      <Loader2 className="h-8 w-8 animate-spin text-primary/40" />
    </div>

    <div className={`w-full relative ${isMobile ? 'flex flex-col' : 'flex flex-col overflow-hidden'}`} style={{
      height: isMobile ? '100dvh' : getContainerHeight(),
      background: 'transparent',
    }}>
      {/* Album art background */}
      {visibleBgUrl && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `url(${visibleBgUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center center',
          }}
        />
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
      <div className={`relative flex flex-col z-0 ${isMobile ? 'flex-1 min-h-0 overflow-hidden' : 'flex-1 overflow-visible'}`} style={isMobile ? { paddingTop: `${MOBILE_HEADER_HEIGHT}px` } : undefined}>
        {loading && brews.length === 0 ? (
          <div
            className="flex justify-center gap-6 w-full px-4 py-2"
            style={{
              height: isAspectRatioLocked ? `${getContentHeight()}px` : `calc(100vh - ${activeHeaderHeight}px${showTimerFooter ? ` - ${TIMER_FOOTER_HEIGHT}px` : ''})`,
            }}
          >
            {[0, 1, 2].map(i => (
              <div key={i} className="flex-1 min-w-0" style={{ height: isAspectRatioLocked ? `${getCardHeight()}px` : 'calc(100% - 16px)' }}>
                <BrewCardSkeleton />
              </div>
            ))}
          </div>
        ) : brews.length === 0 ? (
          <div className="flex items-center justify-center h-full p-4">
            <div className="max-w-2xl w-full p-10 text-center rounded-xl flex flex-col items-center gap-2" style={{
              background: 'linear-gradient(145deg, hsl(222 20% 14% / 0.7) 0%, hsl(222 20% 12% / 0.7) 100%)',
              border: '1px solid hsl(222 15% 25% / 0.4)',
              boxShadow: '0 8px 24px hsl(222 30% 3% / 0.5), 0 4px 10px hsl(222 30% 3% / 0.3), inset 0 1px 0 hsl(0 0% 100% / 0.08)',
              backdropFilter: 'blur(20px)',
            }}>
              <div className="flex items-center justify-center w-16 h-16 rounded-2xl mb-2" style={{
                background: 'hsl(var(--primary) / 0.1)',
                border: '1px solid hsl(var(--primary) / 0.2)',
              }}>
                <Beer className="h-8 w-8 text-primary/70" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Inga öl valda</h2>
              <p className="text-muted-foreground max-w-md">
                Gå till inställningar för att välja vilka öl du vill visa på dashboarden
              </p>
              <Button onClick={() => navigate('/settings')} className="mt-4">
                <Settings className="mr-2 h-4 w-4" />
                Öppna Inställningar
              </Button>
            </div>
          </div>
        ) : isMobile ? (
          <div className="flex flex-col flex-1 min-h-0">
            {brews.length > 1 && (
              <div className="relative py-2 flex-shrink-0">
                <div className="flex justify-center gap-2">
                  {brews.map((_, index) => (
                    <button key={index} onClick={() => emblaApi?.scrollTo(index)} className={`h-2 rounded-full transition-all duration-300 ${index === selectedIndex ? 'w-8 bg-primary' : 'w-2 bg-muted-foreground/30'}`} aria-label={`Gå till öl ${index + 1}`} />
                  ))}
                </div>
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-hidden px-1 pb-1" ref={emblaRef}>
              <div className="flex h-full">
                {brews.map((brew, index) => (
                  <div key={brew.id} className="flex-[0_0_100%] min-w-0 px-1">
                    <BrewCard brew={brew} updatedFields={updatedFields} isAuthenticated={isAuthenticated} pills={pills} controllers={controllers} onShareBrew={handleShareBrew} onEventsChange={loadBrewEvents} onControllerClick={handleControllerClick} cardIndex={index} hasAlbumArtBackground={!!visibleBgUrl} brewCount={brews.length} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div
            className={`${gridLayout} w-full px-4 py-2`}
            style={{
              height: isAspectRatioLocked ? `${getContentHeight()}px` : `calc(100vh - ${activeHeaderHeight}px${showTimerFooter ? ` - ${TIMER_FOOTER_HEIGHT}px` : ''})`,
            }}
          >
            {brews.map((brew, index) => (
              <div
                key={brew.id}
                className={cardWidthClass}
                style={{
                  height: isAspectRatioLocked ? `${getCardHeight()}px` : `calc(100% - 16px)`,
                }}
              >
                <BrewCard brew={brew} updatedFields={updatedFields} isAuthenticated={isAuthenticated} pills={pills} controllers={controllers} onShareBrew={handleShareBrew} onEventsChange={loadBrewEvents} onControllerClick={handleControllerClick} cardIndex={index} hasAlbumArtBackground={!!visibleBgUrl} brewCount={brews.length} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Dialogs */}
      {selectedController && <RaptControllerDialog controller={selectedController} open={controllerDialogOpen} onOpenChange={setControllerDialogOpen} isCooler={selectedControllerIsCooler} />}

      {/* Timer Footer */}
      <TimerFooter timer={externalTimer} timerTvModeOnly={timerTvModeOnly} />
    </div>
  </>;
}
