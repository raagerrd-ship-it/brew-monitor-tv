import { Button } from "@/components/ui/button";
import { RaptControllerDialog } from "./RaptControllerDialog";
import { BrewCard } from "./brew-card/BrewCard";
import { BrewCardSkeleton } from "./brew-card/BrewCardSkeleton";
import { DashboardHeader, HEADER_HEIGHT, HEADER_HEIGHT_TV } from "./DashboardHeader";

import { useEffect, useLayoutEffect, useState, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import dbLogo from "@/assets/db-logo.png";
import { Settings, Loader2, Beer } from "lucide-react";
import { toast as sonnerToast } from "sonner";

import { useBrewData } from "@/hooks/use-brew-data";
import { useBrewDay, type BrewDay } from "@/hooks/use-brew-day";
import { BrewDayCard } from "./brew-card/BrewDayCard";
import { useSplashScreen } from "@/hooks/use-splash-screen";
import { useBrewCarousel } from "@/hooks/use-brew-carousel";
import { useTvRefresh } from "@/hooks/use-tv-refresh";

import { useAspectRatio } from "@/components/AspectRatioContainer";
import { TimerFooter } from "@/components/TimerFooter";
import { ExternalTimerProvider } from "@/hooks/use-external-timer";
import { useDashboardFooter } from "@/contexts/DashboardFooterContext";
import { useHasAlbumArtBackground } from "@/contexts/AlbumArtContext";
import { DashboardBackground } from "./DashboardBackground";
import { DashboardAlertOverlay } from "./DashboardAlertOverlay";
import { CleaningChecklistOverlay } from "./CleaningChecklistOverlay";
import { useCleaningChecklist } from "@/hooks/use-cleaning-checklist";
import { TempController } from "@/types/brew";

import { supabase } from "@/integrations/supabase/client";
import { TvDebugOverlay } from "./TvDebugOverlay";
import { lock, unlock, onMotionLockChange } from "@/lib/motion-lock";

const SLIDE_EASE = 'cubic-bezier(0.45, 0, 0.55, 1)';

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
  } = useBrewData();
  const brewDay = useBrewDay();
  const { view: cleaningView } = useCleaningChecklist();
  const [cleaningEntered, setCleaningEntered] = useState(false);
  const previousCleaningView = useRef(cleaningView);
  const [exitingBrewDay, setExitingBrewDay] = useState<BrewDay | null>(null);
  // True from preparation until the last slide phase is done: freezes the
  // card countdown and keeps the footer mounted. The phases themselves run
  // outside React (runSlide) so nothing re-renders while anything moves.
  const [brewDayTransition, setBrewDayTransition] = useState(false);
  // With two beer cards each slides on its own (measured smoother on Chromecast than moving the whole row).
  const perCardSlide = brews.length === 2;
  const rootRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const beerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const cardRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);

  // Extracted hooks
  const hasAlbumArtBackground = useHasAlbumArtBackground();
  const { emblaRef, emblaApi, selectedIndex, shouldUseCarousel, isMobile, isTvMode } = useBrewCarousel(brews);
  // Pauses competing animations while the motion lock is held, without re-rendering.
  useEffect(() => onMotionLockChange(locked => rootRef.current?.classList.toggle('cleaning-transition-active', locked)), []);
  useLayoutEffect(() => {
    if (!isTvMode || previousCleaningView.current === cleaningView) return;
    const wasShown = !!previousCleaningView.current;
    previousCleaningView.current = cleaningView;
    // Switching between two checklists doesn't slide anything.
    if (wasShown === !!cleaningView) return;
    const main = mainRef.current;
    lock('cleaning');
    if (main) main.style.willChange = 'transform';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(start); clearTimeout(watchdog);
      main?.removeEventListener('transitionend', onEnd);
      if (main) main.style.willChange = '';
      unlock('cleaning');
    };
    const onEnd = (event: TransitionEvent) => { if (event.target === main && event.propertyName === 'transform') finish(); };
    main?.addEventListener('transitionend', onEnd);
    // Give the Chromecast time to repaint without shadows/filters and to
    // rasterize the checklist before the slide starts, in both directions.
    const start = setTimeout(() => setCleaningEntered(!!cleaningView), 700);
    const watchdog = setTimeout(finish, 700 + 4000 + 1500);
    return finish;
  }, [cleaningView, isTvMode]);
  const displayedBrewDay = !isMobile || isTvMode ? brewDay ?? exitingBrewDay : brewDay;
  const { showSplash } = useSplashScreen(loading);
  const [splashGone, setSplashGone] = useState(false);
  const entrancePlayed = useRef(false);
  useEffect(() => {
    if (!splashGone || entrancePlayed.current || !isTvMode) return;
    entrancePlayed.current = true;
    if (rootRef.current?.closest('.cleaning-transition-active') || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cards = beerRefs.current.filter((el): el is HTMLDivElement => !!el);
    cards.forEach((el, index) => {
      const card = el.firstElementChild;
      if (!(card instanceof HTMLElement)) return;
      card.style.setProperty('--card-enter-delay', `${index * 80}ms`);
      card.classList.add('tv-card-enter');
      card.addEventListener('animationend', () => card.classList.remove('tv-card-enter'), { once: true });
    });
  }, [splashGone, isTvMode]);
  useEffect(() => {
    if (showSplash) return;
    const t = setTimeout(() => setSplashGone(true), 600);
    return () => clearTimeout(t);
  }, [showSplash]);
  useTvRefresh(isTvMode);

  // Footer height from self-contained footer components via context
  const { footerHeight, footerContent, footerContentOffset, footerContentHeight } = useDashboardFooter();
  const layoutFooterHeight = footerHeight;

  const [mobileViewportHeight, setMobileViewportHeight] = useState(() => {
    if (typeof window === "undefined") return 0;
    return Math.round(window.visualViewport?.height ?? window.innerHeight);
  });

  // Track cooler controller ID
  const [coolerControllerId, setCoolerControllerId] = useState<string | null>(null);
  useEffect(() => {
    const loadCoolerController = async () => {
      const { data } = await supabase.from('rapt_temp_controllers').select('controller_id').eq('is_glycol_cooler', true).limit(1).maybeSingle();
      if (data?.controller_id) setCoolerControllerId(data.controller_id);
    };
    loadCoolerController();
  }, []);

  const appLoadTime = useMemo(() => new Date(), []);

  // Mobile: lock app height to actual visual viewport to avoid intermittent page scrolling on refresh
  useEffect(() => {
    if (!isMobile || isTvMode) return;

    const updateViewportHeight = () => {
      setMobileViewportHeight(Math.round(window.visualViewport?.height ?? window.innerHeight));
    };

    updateViewportHeight();

    const viewport = window.visualViewport;
    window.addEventListener("resize", updateViewportHeight);
    window.addEventListener("orientationchange", updateViewportHeight);
    viewport?.addEventListener("resize", updateViewportHeight);

    return () => {
      window.removeEventListener("resize", updateViewportHeight);
      window.removeEventListener("orientationchange", updateViewportHeight);
      viewport?.removeEventListener("resize", updateViewportHeight);
    };
  }, [isMobile, isTvMode]);

  // Mobile: prevent document-level scrolling outside dashboard container
  useEffect(() => {
    if (!isMobile || isTvMode) return;

    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevHtmlHeight = html.style.height;
    const prevBodyHeight = body.style.height;

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    html.style.height = "100%";
    body.style.height = "100%";

    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      html.style.height = prevHtmlHeight;
      body.style.height = prevBodyHeight;
    };
  }, [isMobile, isTvMode]);

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

  // Memoized grid layout helpers — beer cards resize in one step (no animated
  // layout); the motion comes from the row and brew day card sliding sideways.
  // With three cards where the last is a keg beer, the brew day card takes its place: keg out right, then brew day in.
  const swapKeg = isTvMode && !isMobile && brews.length === 3 && !!brews[2].frozen;
  const cardCount = brews.length + (displayedBrewDay && !swapKeg ? 1 : 0);
  const gridLayout = useMemo(() => {
    return cardCount >= 3 ? "flex justify-center gap-6" : "flex flex-wrap justify-center gap-6";
  }, [cardCount]);

  const cardWidthClass = useMemo(() => {
    return isTvMode && cardCount === 1 ? "w-2/3" : cardCount >= 3 ? "flex-1 min-w-0" : "w-[calc(50%-0.75rem)]";
  }, [cardCount, isTvMode]);

  // Brew day card matches one card's width; the row starts shifted right by
  // width + gap and slides to 0 while the card glides in from the right.
  const soloBrewDay = isTvMode && brews.length === 0 && !!displayedBrewDay;
  const threeBrewsWithDay = isTvMode && brews.length === 3 && !!displayedBrewDay && !swapKeg;
  const brewDayWidth = swapKeg ? 'calc((100% - 5rem) / 3)' : soloBrewDay ? '66.666667%' : threeBrewsWithDay ? '33.333333%' : cardCount >= 3
    ? `calc((100% - ${(cardCount - 1) * 1.5}rem) / ${cardCount})`
    : 'calc(50% - 0.75rem)';
  // The row is centered, so adding a card moves existing cards left by half
  // of (card width + gap); start shifted by that much so they don't jump.
  // translateX % uses the row's full width incl. its 2rem padding, so subtract it.
  const brewDayShift = threeBrewsWithDay ? 'calc(16.666667% + 0.75rem)' : cardCount >= 3
    ? `calc((100% - 0.5rem) / ${cardCount * 2})`
    : 'calc(25% - 0.125rem)';

  useLayoutEffect(() => {
    if (isMobile && !isTvMode) return;
    const enter = !!brewDay;
    if (!enter && !exitingBrewDay) return;
    lock('brew-day');
    if (enter) setExitingBrewDay(brewDay);
    setBrewDayTransition(true);
    const row = rowRef.current, card = cardRef.current;
    const beers = perCardSlide ? beerRefs.current.slice(0, 2).filter((el): el is HTMLDivElement => !!el) : [];
    const beerShift = perCardSlide && row ? `translateX(${(row.offsetWidth - 8) / 6}px)` : '';
    const rowShift = `translateX(${brewDayShift})`;
    const cardOut = 'translateX(calc(100% + 1.5rem))';
    if (enter) {
      // Start positions, applied before the first paint.
      for (const el of beers) { el.style.transition = 'none'; el.style.transform = beerShift; }
      if (row && !perCardSlide && !swapKeg) { row.style.transition = 'none'; row.style.transform = rowShift; }
      if (card) { card.style.transition = 'none'; card.style.transform = cardOut; }
    }
    type Step = { el: HTMLElement; transform: string; ms: number; pause: number; opacity?: string };
    const moved: HTMLElement[] = [];
    let cancelled = false;
    let finished = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = () => {
      finished = true;
      for (const el of moved) el.style.willChange = '';
      setBrewDayTransition(false);
      if (!enter) setExitingBrewDay(null);
      unlock('brew-day');
    };
    const run = (steps: Step[], i: number) => {
      if (cancelled) return;
      const step = steps[i];
      if (!step) return finish();
      const { el } = step;
      let done = false;
      const next = () => {
        if (done || cancelled) return;
        done = true;
        el.removeEventListener('transitionend', onEnd);
        clearTimeout(watchdog);
        timers.push(setTimeout(() => run(steps, i + 1), step.pause));
      };
      // Phase watchdog: continue as if transitionend came after duration + 1500 ms.
      const onEnd = (event: TransitionEvent) => { if (event.target === el && event.propertyName === 'transform') next(); };
      el.addEventListener('transitionend', onEnd);
      moved.push(el);
      el.style.willChange = 'transform';
      el.style.transition = `transform ${step.ms}ms ${SLIDE_EASE}${step.opacity ? `, opacity ${step.ms}ms ${SLIDE_EASE}` : ''}`;
      el.style.transform = step.transform;
      if (step.opacity) el.style.opacity = step.opacity;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const watchdog = setTimeout(next, reduced ? 0 : step.ms + 1500);
      timers.push(watchdog);
    };
    // Beer cards switch width (and charts redraw) on mount; give the
    // Chromecast time to finish that before any sliding starts.
    timers.push(setTimeout(() => {
      const footer = footerRef.current;
      const footerSlides = !!footer && footer.dataset.footerVisible === (enter ? '1' : '0');
      const keg = swapKeg ? beerRefs.current[2] : null;
      const rowSteps: Step[] = keg
        ? [{ el: keg, transform: enter ? cardOut : 'translateX(0)', ms: 1200, pause: 300 }]
        : perCardSlide
        ? (enter ? beers : [...beers].reverse()).map(el => ({ el, transform: enter ? 'translateX(0)' : beerShift, ms: 1200, pause: 300 }))
        : row ? [{ el: row, transform: enter ? 'translateX(0)' : rowShift, ms: 1200, pause: 300 }] : [];
      const cardStep: Step[] = card ? [{ el: card, transform: enter ? 'translateX(0)' : cardOut, ms: enter ? 1400 : 1200, pause: enter ? 400 : 200 }] : [];
      // On the way out the footer leaves the screen anyway, so it only slides (no fade).
      const footerStep: Step[] = footerSlides ? [{ el: footer!, transform: enter ? 'translateY(0)' : 'translateY(100%)', opacity: enter ? '1' : undefined, ms: 2000, pause: 200 }] : [];
      run(enter ? [...rowSteps, ...cardStep, ...footerStep] : [...footerStep, ...cardStep, ...rowSteps], 0);
    }, 700));
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      if (!finished) unlock('brew-day');
    };
  }, [isTvMode, isMobile, !!brewDay]);
  // After the exit the card is gone and the row is back to its own layout.
  useLayoutEffect(() => {
    if (displayedBrewDay) return;
    for (const el of [rowRef.current, ...beerRefs.current]) {
      if (el) { el.style.transform = ''; el.style.transition = ''; el.style.willChange = ''; }
    }
  }, [!!displayedBrewDay]);

  // Layout calculations
  const MOBILE_HEADER_HEIGHT = controllers.length > 0 ? 112 : 56;
  const activeHeaderHeight = isTvMode ? HEADER_HEIGHT_TV : HEADER_HEIGHT;
  const CONTENT_PADDING = 16;

  const getContainerHeight = () => {
    if (isAspectRatioLocked) return `${containerHeight}px`;
    return '100vh';
  };

  const getContentHeight = () => {
    if (isAspectRatioLocked) {
      const footerSpace = layoutFooterHeight;
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

  const mobileContainerHeight = mobileViewportHeight > 0 ? `${mobileViewportHeight}px` : '100dvh';

  return <ExternalTimerProvider>
    {/* Splash overlay — unmounted after fade to free the decoded logo */}
    {!splashGone && <div
      className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center gap-4 pointer-events-none"
      style={{
        opacity: showSplash ? 1 : 0,
        transition: 'opacity 0.5s ease-out',
        ...(showSplash ? {} : { visibility: 'hidden' as const, transitionProperty: 'opacity, visibility', transitionDelay: '0s, 0.5s' }),
      }}
    >
      <img src={dbLogo} alt="Bryggövervakare" className="max-h-[60vh] w-auto object-contain invert" />
      <Loader2 className="h-8 w-8 animate-spin text-primary/40" />
    </div>}

    <div ref={rootRef} className="w-full relative flex flex-col overflow-hidden" style={{
      height: isMobile ? mobileContainerHeight : getContainerHeight(),
      background: 'transparent',
    }}>
      {/* Album art background */}
      <DashboardBackground />

      {/* Header Bar */}
      <DashboardHeader
        hasAlbumArtBackground={hasAlbumArtBackground}
        onRefresh={isMobile ? handleManualRefresh : undefined}
      />

      {/* Main Display Area */}
       <div className={`relative flex flex-col z-0 ${isMobile ? 'flex-1 min-h-0 overflow-hidden motion-reduce:!transition-none' : 'flex-1 overflow-visible'} ${isTvMode ? 'motion-reduce:!transition-none' : ''}`} ref={mainRef} style={{
         ...(isMobile ? { paddingTop: `${MOBILE_HEADER_HEIGHT}px`, paddingBottom: `${layoutFooterHeight}px` } : {}),
           ...(isTvMode ? { transform: cleaningEntered ? 'translateX(-100%)' : 'translateX(0)', transition: 'transform 4000ms cubic-bezier(0.37, 0, 0.63, 1)' } : {}),
       }}>
        {loading && brews.length === 0 ? (
          <div
            className="flex justify-center gap-6 w-full px-4 py-2 motion-reduce:!transition-none"
            style={{
              height: isAspectRatioLocked ? `${getContentHeight()}px` : `calc(100vh - ${activeHeaderHeight}px${layoutFooterHeight > 0 ? ` - ${layoutFooterHeight}px` : ''})`,
            }}
          >
            {[0, 1, 2].map(i => (
              <div key={i} className="flex-1 min-w-0 motion-reduce:!transition-none" style={{ height: isAspectRatioLocked ? `${getCardHeight()}px` : 'calc(100% - 16px)' }}>
                <BrewCardSkeleton />
              </div>
            ))}
          </div>
        ) : brews.length === 0 && !displayedBrewDay ? (
          <div className="h-full" />
        ) : isMobile ? (
          <div className="flex flex-col flex-1 min-h-0">
            {brews.length > 1 && (
              <div className="relative py-2 flex-shrink-0">
                <div className="flex justify-center gap-2">
                  {brews.map((_, index) => (
                    <button key={index} onClick={() => emblaApi?.scrollTo(index)} className={`h-2 rounded-full ${index === selectedIndex ? 'w-8 bg-primary' : 'w-2 bg-muted-foreground/30'}`} aria-label={`Gå till öl ${index + 1}`} />
                  ))}
                </div>
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-hidden px-1 pb-1" ref={emblaRef}>
              <div className="flex h-full">
                {brews.map((brew, index) => (
                  <div key={brew.id} className="flex-[0_0_100%] min-w-0 px-1">
                    <BrewCard brew={brew} updatedFields={updatedFields} isAuthenticated={isAuthenticated} pills={pills} controllers={controllers} onShareBrew={handleShareBrew} onEventsChange={loadBrewEvents} onControllerClick={handleControllerClick} cardIndex={index} hasAlbumArtBackground brewCount={brews.length} />
                  </div>
                ))}
                {brewDay && (
                  <div className="flex-[0_0_100%] min-w-0 px-1"><BrewDayCard day={brewDay} hasAlbumArtBackground /></div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div
            ref={rowRef}
            className={`${gridLayout} relative w-full px-4 py-2 motion-reduce:!transition-none`}
            style={{
              height: isAspectRatioLocked ? `${getContentHeight()}px` : `calc(100vh - ${activeHeaderHeight}px${layoutFooterHeight > 0 ? ` - ${layoutFooterHeight}px` : ''})`,
            }}
          >
            {brews.map((brew, index) => (
              <div
                key={brew.id}
                ref={el => { beerRefs.current[index] = el; }}
                className={`${cardWidthClass} motion-reduce:!transition-none`}
                style={{
                  height: isAspectRatioLocked ? `${getCardHeight()}px` : `calc(100% - 16px)`,
                    }}
              >
                <BrewCard brew={brew} updatedFields={updatedFields} isAuthenticated={isAuthenticated} pills={pills} controllers={controllers} onShareBrew={handleShareBrew} onEventsChange={loadBrewEvents} onControllerClick={handleControllerClick} cardIndex={index} hasAlbumArtBackground brewCount={brews.length} />
              </div>
            ))}
            {displayedBrewDay && !swapKeg && (
              <div className={`${cardWidthClass} invisible motion-reduce:!transition-none`} style={threeBrewsWithDay ? { flex: `0 0 ${brewDayWidth}` } : undefined} aria-hidden="true" />
            )}
            {displayedBrewDay && (
              <div
                ref={cardRef}
                className="absolute motion-reduce:!transition-none"
                style={{
                  top: '0.5rem',
                   right: soloBrewDay ? '16.666667%' : '1rem',
                  width: brewDayWidth,
                  height: isAspectRatioLocked ? `${getCardHeight()}px` : `calc(100% - 16px)`,
                }}
              >
                 <BrewDayCard day={displayedBrewDay} hasAlbumArtBackground isTvMode={isTvMode} transitionActive={brewDayTransition} compact={isTvMode && (swapKeg || cardCount >= 3)} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Dialogs */}
      {selectedController && <RaptControllerDialog controller={selectedController} open={controllerDialogOpen} onOpenChange={setControllerDialogOpen} isCooler={selectedControllerIsCooler} controllerColor={pills.find(p => p.pill_id === selectedController.linked_pill_id)?.color || undefined} />}

      {/* Footer Slot: context-driven content or self-rendering components */}
      <TimerFooter brewDay={brewDay} sliding={brewDayTransition} slideRef={footerRef} />
      {footerContent && (
        <div className="absolute left-0 right-0 z-20" style={{ bottom: `${footerContentOffset}px`, height: `${footerContentHeight}px` }}>
          {footerContent}
        </div>
      )}

      {/* Global alert overlay */}
      <DashboardAlertOverlay />

      {/* Shared cleaning checklist (toggled from the menu, mirrored on TV) */}
      <CleaningChecklistOverlay entered={cleaningEntered} />

      {/* TV Debug Overlay */}
      {/* {!isTvMode && <TvDebugOverlay />} */}
    </div>
  </ExternalTimerProvider>;
}
