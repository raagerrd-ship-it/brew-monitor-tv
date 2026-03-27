import { Button } from "@/components/ui/button";
import { Logo } from "./Logo";
import { NotificationBell } from "./NotificationBell";
import { Clock } from "./Clock";
import { Fragment, memo, useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Settings, Pill, AirVent, LogOut, RefreshCw, WifiOff } from "lucide-react";
import { getActualTemp } from "@/lib/temp-display";
import { useIsMobile } from "@/hooks";
import { useTvMode } from "@/contexts/TvModeContext";
import { TempController } from "@/types/brew";
import { DEFAULT_DEVICE_COLOR } from "@/lib/brew-utils";
import { supabase } from "@/integrations/supabase/client";
import { useRaptBarData } from "@/hooks/use-rapt-bar-data";
import { RaptControllerDialog } from "./RaptControllerDialog";

const HEADER_HEIGHT_DESKTOP = 60;
const HEADER_HEIGHT_TV = 60;
const HEADER_HEIGHT = HEADER_HEIGHT_DESKTOP;
export { HEADER_HEIGHT, HEADER_HEIGHT_TV, HEADER_HEIGHT_DESKTOP };

interface DashboardHeaderProps {
  hasAlbumArtBackground?: boolean;
  onLogout?: () => void;
  onRefresh?: () => void;
  sonosSlot?: React.ReactNode;
}

export function DashboardHeader({
  hasAlbumArtBackground = false,
  onLogout,
  onRefresh,
  sonosSlot,
}: DashboardHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const { isTvMode } = useTvMode();
  const isOnSettings = location.pathname === '/settings';

  // RAPT bar data — self-contained
  const { controllers, pills } = useRaptBarData();

  // Controller dialog state
  const [selectedController, setSelectedController] = useState<TempController | null>(null);
  const [selectedControllerIsCooler, setSelectedControllerIsCooler] = useState(false);
  const [controllerDialogOpen, setControllerDialogOpen] = useState(false);
  const [coolerControllerId, setCoolerControllerId] = useState<string | null>(null);

  useEffect(() => {
    const loadCoolerController = async () => {
      const { data } = await supabase.from('auto_cooling_settings').select('cooler_controller_id').limit(1).maybeSingle();
      if (data?.cooler_controller_id) setCoolerControllerId(data.cooler_controller_id);
    };
    loadCoolerController();
  }, []);

  const handleControllerClick = useCallback((controller: TempController) => {
    setSelectedController(controller);
    setSelectedControllerIsCooler(coolerControllerId === controller.controller_id);
    setControllerDialogOpen(true);
  }, [coolerControllerId]);

  return (
    <>
      <div
        className={`overflow-visible z-20 ${isTvMode ? '' : 'transition-all duration-500'} ${isMobile ? 'flex flex-col py-2 px-2 gap-2 fixed top-0 left-0 right-0' : 'flex-shrink-0 flex items-center justify-between pl-2 pr-6 gap-6 relative'}`}
        style={{
          height: isMobile ? 'auto' : `${HEADER_HEIGHT_DESKTOP}px`,
          background: 'transparent',
          borderBottom: 'none'
        }}
      >
        {/* Mobile: Logo row with settings */}
        {isMobile ? (
          <div className="flex items-center justify-between w-full">
            <div className="cursor-pointer" onClick={() => navigate('/')}>
              <Logo />
            </div>
            <div className="flex items-center gap-1">
              {onRefresh && !isOnSettings && (
                <div className="relative flex items-center justify-center" style={{ width: '36px', height: '36px' }}>
                  <Button variant="ghost" size="icon" onClick={onRefresh} className="opacity-40 hover:opacity-100 hover:bg-transparent transition-opacity duration-200 w-full h-full rounded-full">
                    <RefreshCw className="w-5 h-5" />
                  </Button>
                </div>
              )}
              <NotificationBell />
              <div className="relative flex items-center justify-center" style={{ width: '36px', height: '36px' }}>
                <Button variant="ghost" size="icon" onClick={() => navigate('/settings')} className={`hover:bg-transparent transition-opacity duration-200 w-full h-full rounded-full ${isOnSettings ? 'opacity-100' : 'opacity-40 hover:opacity-100'}`}>
                  <Settings className="w-5 h-5" />
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {/* RAPT Section - Mobile */}
        {isMobile && controllers.length > 0 && (
          <RaptControllerBar controllers={controllers} pills={pills} onControllerClick={handleControllerClick} isMobile={true} isTvMode={isTvMode} />
        )}

        {/* Desktop: Three-column layout */}
        {!isMobile && (
          <>
            <div className="flex items-center flex-shrink-0" style={{ cursor: isTvMode ? 'default' : 'pointer' }} onClick={isTvMode ? undefined : () => navigate('/')}>
              {sonosSlot ?? <Logo />}
            </div>

            <div className="flex-1 flex items-center justify-center min-w-0 overflow-hidden">
              {controllers.length > 0 && (
                <RaptControllerBar controllers={controllers} pills={pills} onControllerClick={handleControllerClick} isMobile={false} isTvMode={isTvMode} />
              )}
            </div>

            <div className="flex items-center gap-4 flex-shrink-0 self-stretch">
              <Clock />

              {!isTvMode && <NotificationBell />}

              {!isTvMode && (
                <div className="relative flex items-center justify-center" style={{ width: '40px', height: '40px' }}>
                  <Button variant="ghost" size="icon" onClick={() => navigate('/settings')} className={`hover:bg-transparent transition-opacity duration-200 w-full h-full rounded-full ${isOnSettings ? 'opacity-100' : 'opacity-40 hover:opacity-100'}`}>
                    <Settings className="transition-colors duration-200" style={{ width: '50%', height: '50%' }} />
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Controller dialog — owned by header */}
      {selectedController && (
        <RaptControllerDialog
          controller={selectedController}
          open={controllerDialogOpen}
          onOpenChange={setControllerDialogOpen}
          isCooler={selectedControllerIsCooler}
          controllerColor={pills.find(p => p.pill_id === selectedController.linked_pill_id)?.color || undefined}
        />
      )}
    </>
  );
}

// Extracted sub-component for RAPT controller bar
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

// Helper to format duration like "3t 24m"
function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}t ${minutes}m`;
  return `${minutes}m`;
}

// Helper to format time like "08:01"
function formatTime(date: Date): string {
  return date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}

export const RaptControllerBar = memo(function RaptControllerBar({
  controllers,
  pills,
  onControllerClick,
  isMobile,
  isTvMode = false,
}: RaptControllerBarProps) {
  const [now, setNow] = useState(() => Date.now());
  const [raptDegraded, setRaptDegraded] = useState(false);
  const [lastSuccessfulSync, setLastSuccessfulSync] = useState<Date | null>(null);
  const [staleThresholdMin, setStaleThresholdMin] = useState(31);

  // Find the most recent last_update across all controllers
  const latestUpdate = useMemo(() => {
    let latest: Date | null = null;
    for (const c of controllers) {
      if (c.last_update) {
        const d = new Date(c.last_update);
        if (!latest || d > latest) latest = d;
      }
    }
    return latest;
  }, [controllers]);

  const staleMinutes = latestUpdate ? (now - latestUpdate.getTime()) / 60000 : 0;
  const isStale = staleMinutes > staleThresholdMin;

  // Check RAPT degraded mode + dynamic stale threshold based on sync interval
  useEffect(() => {
    const check = async () => {
      const { data } = await supabase
        .from('sync_settings')
        .select('last_successful_rapt_sync_at, last_rapt_quick_sync_at, rapt_sync_interval')
        .limit(1)
        .maybeSingle();
      if (!data) return;
      const lastSuccess = data.last_successful_rapt_sync_at ? new Date(data.last_successful_rapt_sync_at) : null;
      const lastQuick = data.last_rapt_quick_sync_at ? new Date(data.last_rapt_quick_sync_at) : null;
      const syncIntervalSec = (data as any).rapt_sync_interval ?? 300;
      const thresholdMin = Math.max(31, Math.round((syncIntervalSec * 2) / 60) + 20);
      setStaleThresholdMin(thresholdMin);
      setLastSuccessfulSync(lastSuccess);
      if (lastSuccess && lastQuick) {
        const sinceSuccess = Date.now() - lastSuccess.getTime();
        setRaptDegraded(sinceSuccess > thresholdMin * 60 * 1000);
      } else {
        setRaptDegraded(false);
      }
    };
    check();
    const interval = setInterval(check, 60000);
    return () => clearInterval(interval);
  }, [controllers]);

  const showWarning = isStale || raptDegraded;

  // Tick every 30s to keep duration updated
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="w-full">
      <div className="relative w-full">
        <div className={`flex items-center rounded-lg isolate overflow-hidden px-3 justify-evenly scrollbar-hide backdrop-blur-xl`} style={{
          background: 'linear-gradient(180deg, hsl(222 20% 13% / 0.7) 0%, hsl(222 20% 9% / 0.75) 100%)',
          border: showWarning ? '1px solid hsl(0 70% 45% / 0.6)' : '1px solid hsl(222 15% 30% / 0.35)',
          boxShadow: 'inset 0 1px 0 hsl(0 0% 100% / 0.08), inset 0 -1px 0 hsl(0 0% 0% / 0.2)',
          height: '50px',
        }}>
          {/* RAPT API status indicator — stale data (no updates at all) */}
          {isStale && latestUpdate && (
            <>
              <div className="flex items-center gap-1.5 flex-shrink-0 pr-1" title={`RAPT API svarar inte sedan ${formatTime(latestUpdate)}. Senaste data är ${formatDuration(now - latestUpdate.getTime())} gammal.`}>
                <WifiOff className="w-3.5 h-3.5 text-destructive animate-pulse" />
                <span className="text-[11px] font-medium text-destructive whitespace-nowrap">
                  {formatTime(latestUpdate)}–{formatTime(new Date(now))} ({formatDuration(now - latestUpdate.getTime())})
                </span>
              </div>
              <div className="h-8 mx-1 w-px" style={{ background: 'hsl(0 40% 30%)' }} />
            </>
          )}
          {/* RAPT API degraded mode — syncs run but API fails */}
          {!isStale && raptDegraded && lastSuccessfulSync && (
            <>
              <div className="flex items-center gap-1.5 flex-shrink-0 pr-1" title={`RAPT API nere. Senaste lyckade synk: ${formatTime(lastSuccessfulSync)}. Systemet kör på cachad data.`}>
                <WifiOff className="w-3.5 h-3.5 text-destructive animate-pulse" />
                <span className="text-[11px] font-medium text-destructive whitespace-nowrap">
                  API nere sedan {formatTime(lastSuccessfulSync)}
                </span>
              </div>
              <div className="h-8 mx-1 w-px" style={{ background: 'hsl(0 40% 30%)' }} />
            </>
          )}

          {controllers.map((controller, index) => {
            const linkedPill = pills.find(p => p.pill_id === controller.linked_pill_id);
            const controllerColor = linkedPill?.color && linkedPill.color !== '#000000' ? linkedPill.color : DEFAULT_DEVICE_COLOR;
            const isPillStale = linkedPill?.last_update ? (new Date().getTime() - new Date(linkedPill.last_update).getTime()) / (1000 * 60 * 60) > 24 : true;
            return (
              <Fragment key={controller.id}>
                {index > 0 && <div className="h-7 mx-0.5 w-px flex-shrink-0" style={{ background: 'hsl(222 15% 20%)' }} />}

                 {(() => {
                   const controllerStaleMin = controller.last_update ? (now - new Date(controller.last_update).getTime()) / 60000 : 0;
                   const isControllerStale = controllerStaleMin > staleThresholdMin;
                   const batteryLevel = linkedPill ? Math.floor(linkedPill.battery_level) : 0;
                   const batteryColor = batteryLevel < 20 ? 'hsl(0 70% 50%)' : controllerColor;
                   return (
                 <div className={`relative flex items-center justify-center rounded px-3 gap-2 flex-1 ${isTvMode ? '' : 'cursor-pointer'}`} style={{ background: 'transparent', paddingTop: '4px', paddingBottom: linkedPill ? '10px' : '4px' }}
                  onClick={isTvMode ? undefined : () => onControllerClick(controller)}
                  onMouseEnter={!isMobile && !isTvMode ? e => { e.currentTarget.style.background = 'hsl(222 18% 15%)'; } : undefined}
                  onMouseLeave={!isMobile && !isTvMode ? e => { e.currentTarget.style.background = 'transparent'; } : undefined}
                  title={!isMobile && !isTvMode ? `${controller.name}\nInbyggd: ${controller.current_temp !== null ? controller.current_temp.toFixed(1) : '--'}°${controller.pill_temp !== null ? `\nPill: ${controller.pill_temp.toFixed(1)}°` : ''}\nMål: ${controller.target_temp !== null ? controller.target_temp.toFixed(1) : '--'}°${isControllerStale ? `\n\n⚠️ Ingen data på ${formatDuration(now - new Date(controller.last_update!).getTime())}` : ''}\n\nKlicka för att ändra inställningar` : undefined}
                >
                   {isControllerStale && (
                     <WifiOff className="w-3 h-3 text-destructive animate-pulse flex-shrink-0" />
                   )}

                   {/* Temp first (left) */}
                   {(() => {
                      const displayTemp = (controller as any).actual_temp ?? getActualTemp(controller.pill_temp, controller.current_temp);
                     return (
                      <span className="font-semibold tabular-nums whitespace-nowrap" style={{
                        fontSize: '16px',
                        ...(isControllerStale ? { color: 'hsl(0 0% 95%)' } : linkedPill?.color ? { color: linkedPill.color, textShadow: `0 0 8px ${controllerColor}44` } : {}),
                      }}>
                       {displayTemp !== null ? `${displayTemp.toFixed(1)}°` : '--°'}
                     </span>
                     );
                   })()}

                   {/* Sensor icons (right) — show which sensors are active */}
                   {!isControllerStale && !controller.is_glycol_cooler && (() => {
                      const isDual = !!(controller as any).dual_sensor_enabled;
                      const preferred = (controller as any).preferred_sensor as string | undefined;
                      const hasPill = !!linkedPill && !isPillStale;
                      const pillActive = hasPill && (isDual || preferred === 'pill');
                      const probeActive = isDual || preferred === 'probe' || !hasPill;
                      return (
                         <div className="flex items-center gap-1.5">
                           <Pill style={{
                             width: '0.65rem',
                             height: '0.65rem',
                             flexShrink: 0,
                             opacity: pillActive ? 1 : 0.2,
                             color: pillActive ? controllerColor : 'currentColor',
                             filter: pillActive ? `drop-shadow(0 0 3px ${controllerColor}88)` : 'none',
                           }} strokeWidth={2} />
                           <AirVent style={{
                             width: '0.65rem',
                             height: '0.65rem',
                             flexShrink: 0,
                             opacity: probeActive ? 0.9 : 0.2,
                             color: probeActive ? controllerColor : 'currentColor',
                             filter: probeActive ? `drop-shadow(0 0 3px ${controllerColor}88)` : 'none',
                           }} />
                         </div>
                      );
                    })()}

                   {/* Battery bar — styled like PWM duty bar */}
                   {linkedPill && (
                     <div className="absolute bottom-1 left-1.5 right-1.5 rounded-full overflow-hidden" style={{
                       height: '4px',
                       background: 'hsl(0 0% 0% / 0.5)',
                       boxShadow: 'inset 0 1px 2px hsl(0 0% 0% / 0.6), inset 0 -1px 0 hsl(0 0% 100% / 0.05)',
                     }}>
                       <div
                         className="absolute top-0 bottom-0 left-0 rounded-full transition-all duration-500"
                         style={{
                           width: `${Math.max(batteryLevel, 1)}%`,
                           background: batteryColor,
                           opacity: 0.7,
                           boxShadow: `0 0 6px ${batteryColor}`,
                         }}
                       />
                       {/* Glass highlight */}
                       <div
                         className="absolute inset-0 rounded-full pointer-events-none"
                         style={{ background: 'linear-gradient(180deg, hsl(0 0% 100% / 0.2) 0%, transparent 40%)' }}
                       />
                     </div>
                   )}
                 </div>
                   );
                 })()}
                </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
});
