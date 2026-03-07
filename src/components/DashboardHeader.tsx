import { Button } from "@/components/ui/button";
import { Logo } from "./Logo";
import { NotificationBell } from "./NotificationBell";
import { Clock } from "./Clock";
import { memo, useState, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Settings, Pill, AirVent, LogOut, RefreshCw, WifiOff } from "lucide-react";
import { getActualTemp } from "@/lib/temp-display";
import { useIsMobile } from "@/hooks";
import { useTvMode } from "@/contexts/TvModeContext";
import { TempController } from "@/types/brew";
import { DEFAULT_DEVICE_COLOR } from "@/lib/brew-utils";
import { supabase } from "@/integrations/supabase/client";

const HEADER_HEIGHT_DESKTOP = 60;
const HEADER_HEIGHT_TV = 60;
const HEADER_HEIGHT = HEADER_HEIGHT_DESKTOP;
export { HEADER_HEIGHT, HEADER_HEIGHT_TV, HEADER_HEIGHT_DESKTOP };

interface DashboardHeaderProps {
  controllers: TempController[];
  pills: {
    pill_id: string;
    color: string;
    name: string;
    battery_level: number;
    last_update: string | null;
  }[];
  onControllerClick?: (controller: TempController) => void;
  hasAlbumArtBackground?: boolean;
  onLogout?: () => void;
  onRefresh?: () => void;
  pillCompEnabled?: boolean;
  sonosSlot?: React.ReactNode;
}

export function DashboardHeader({
  controllers,
  pills,
  onControllerClick,
  hasAlbumArtBackground = false,
  onLogout,
  onRefresh,
  pillCompEnabled = false,
  sonosSlot,
}: DashboardHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const { isTvMode } = useTvMode();
  const isOnSettings = location.pathname === '/settings';

  return (
    <div
      className={`overflow-visible z-20 ${isTvMode ? '' : 'transition-all duration-500'} ${isMobile ? 'flex flex-col py-2 px-2 gap-2 fixed top-0 left-0 right-0' : 'flex-shrink-0 flex items-center justify-between pl-2 pr-6 gap-6 relative'}`}
      style={{
        height: isMobile ? 'auto' : `${HEADER_HEIGHT_DESKTOP}px`,
        background: 'transparent',
        borderBottom: 'none'
      }}
    >
      {/* Top highlight removed for seamless transparent header */}

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
        <RaptControllerBar controllers={controllers} pills={pills} onControllerClick={onControllerClick || (() => {})} isMobile={true} isTvMode={isTvMode} pillCompEnabled={pillCompEnabled} />
      )}

      {/* Desktop: Three-column layout */}
      {!isMobile && (
        <>
          <div className="flex items-center flex-shrink-0" style={{ cursor: isTvMode ? 'default' : 'pointer' }} onClick={isTvMode ? undefined : () => navigate('/')}>
            {sonosSlot ?? <Logo />}
          </div>

          <div className="flex-1 flex items-center justify-center">
            {controllers.length > 0 && (
              <RaptControllerBar controllers={controllers} pills={pills} onControllerClick={onControllerClick || (() => {})} isMobile={false} isTvMode={isTvMode} pillCompEnabled={pillCompEnabled} />
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
  pillCompEnabled?: boolean;
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
  pillCompEnabled = false,
}: RaptControllerBarProps) {
  const [now, setNow] = useState(() => Date.now());
  const [raptDegraded, setRaptDegraded] = useState(false);
  const [lastSuccessfulSync, setLastSuccessfulSync] = useState<Date | null>(null);

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
  const isStale = staleMinutes > 31;

  // Check RAPT degraded mode: last_successful differs from last_quick_sync
  useEffect(() => {
    const check = async () => {
      const { data } = await supabase
        .from('sync_settings')
        .select('last_successful_rapt_sync_at, last_rapt_quick_sync_at')
        .limit(1)
        .maybeSingle();
      if (!data) return;
      const lastSuccess = data.last_successful_rapt_sync_at ? new Date(data.last_successful_rapt_sync_at) : null;
      const lastQuick = data.last_rapt_quick_sync_at ? new Date(data.last_rapt_quick_sync_at) : null;
      setLastSuccessfulSync(lastSuccess);
      // Degraded if last quick sync ran but success is >10 min older
      if (lastSuccess && lastQuick) {
        const drift = lastQuick.getTime() - lastSuccess.getTime();
        setRaptDegraded(drift > 10 * 60 * 1000);
      } else {
        setRaptDegraded(false);
      }
    };
    check();
    // Re-check when controllers update (means a sync just ran)
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
    <div className={isMobile ? "flex items-center justify-center w-full" : ""}>
      <div className="relative">
        <div className={`flex items-center rounded-lg ${isMobile ? 'gap-1 px-2 py-2' : 'gap-2 px-3 py-1'} overflow-x-auto scrollbar-hide backdrop-blur-xl`} style={{
          background: 'hsl(222 20% 11% / 0.65)',
          border: showWarning ? '1px solid hsl(0 70% 45% / 0.6)' : '1px solid hsl(222 15% 35% / 0.6)',
          boxShadow: showWarning
            ? '0 0 20px hsl(0 50% 30% / 0.3), inset 0 1px 0 hsl(0 0% 100% / 0.1)'
            : '0 0 20px hsl(0 0% 0% / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.1)',
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
              <div className={`${isMobile ? 'h-6 mx-1' : 'h-8 mx-1'} w-px`} style={{ background: 'hsl(0 40% 30%)' }} />
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
              <div className={`${isMobile ? 'h-6 mx-1' : 'h-8 mx-1'} w-px`} style={{ background: 'hsl(0 40% 30%)' }} />
            </>
          )}

          {controllers.map((controller, index) => {
            const linkedPill = pills.find(p => p.pill_id === controller.linked_pill_id);
            const controllerColor = linkedPill?.color && linkedPill.color !== '#000000' ? linkedPill.color : DEFAULT_DEVICE_COLOR;
            const isPillStale = linkedPill?.last_update ? (new Date().getTime() - new Date(linkedPill.last_update).getTime()) / (1000 * 60 * 60) > 24 : true;
            return (
              <div key={controller.id} className="flex items-center">
                {index > 0 && <div className={`${isMobile ? 'h-6 mx-1' : 'h-8 mx-2'} w-px`} style={{ background: 'hsl(222 15% 20%)' }} />}

                 {(() => {
                   const controllerStaleMin = controller.last_update ? (now - new Date(controller.last_update).getTime()) / 60000 : 0;
                   const isControllerStale = controllerStaleMin > 31;
                   return (
                 <div className={`flex items-center flex-shrink-0 rounded ${isMobile ? 'px-2 py-1 gap-2' : 'px-3 py-1 gap-3'} ${isTvMode ? '' : 'cursor-pointer'}`} style={{ background: 'transparent' }}
                  onClick={isTvMode ? undefined : () => onControllerClick(controller)}
                  onMouseEnter={!isMobile && !isTvMode ? e => { e.currentTarget.style.background = 'hsl(222 18% 15%)'; } : undefined}
                  onMouseLeave={!isMobile && !isTvMode ? e => { e.currentTarget.style.background = 'transparent'; } : undefined}
                  title={!isMobile && !isTvMode ? `${controller.name}\nInbyggd: ${controller.current_temp !== null ? controller.current_temp.toFixed(1) : '--'}°${controller.pill_temp !== null ? `\nPill: ${controller.pill_temp.toFixed(1)}°` : ''}\nMål: ${controller.target_temp !== null ? controller.target_temp.toFixed(1) : '--'}°${isControllerStale ? `\n\n⚠️ Ingen data på ${formatDuration(now - new Date(controller.last_update!).getTime())}` : ''}\n\nKlicka för att ändra inställningar` : undefined}
                >
                   {isControllerStale && (
                     <WifiOff className="w-3 h-3 text-destructive animate-pulse flex-shrink-0" />
                   )}
                   {!isMobile && !isControllerStale && (
                     <AirVent style={{
                       width: '1rem',
                       height: '1rem',
                       color: controllerColor,
                       flexShrink: 0,
                       opacity: 0.7
                     }} />
                   )}

                   {(() => {
                     const displayTemp = getActualTemp(controller.pill_temp, controller.current_temp, pillCompEnabled);
                     return (
                     <span className={`font-semibold tabular-nums whitespace-nowrap ${isMobile ? 'text-sm' : ''}`} style={{
                       fontSize: isMobile ? undefined : '16px',
                       ...(isControllerStale ? { color: 'hsl(0 0% 95%)' } : linkedPill?.color ? { color: linkedPill.color } : {})
                     }}>
                      {displayTemp !== null ? `${displayTemp.toFixed(1)}°` : '--°'}
                    </span>
                     );
                   })()}

                   {linkedPill && (
                     <div className={`flex items-center gap-1 transition-opacity ${isPillStale ? 'opacity-40' : isMobile ? 'opacity-60' : ''}`} title={!isMobile ? `${linkedPill.name}\nBatteri: ${linkedPill.battery_level}%${isPillStale ? '\n⚠️ Ingen uppdatering på >24h' : ''}` : undefined}>
                       <div className="relative flex items-center">
                       {!isMobile && (
                         <Pill style={{
                           width: '0.7rem',
                           height: '0.7rem',
                           flexShrink: 0
                         }} color={linkedPill.color} strokeWidth={2} />
                       )}
                       </div>
                       <span className={`font-semibold tabular-nums whitespace-nowrap ${isMobile ? 'text-[10px]' : ''}`} style={{
                         fontSize: isMobile ? undefined : '14px',
                         color: linkedPill.color
                       }}>
                         {Math.floor(linkedPill.battery_level)}<span style={{ opacity: 0.4 }}>.{(linkedPill.battery_level % 1).toFixed(1).slice(2)}%</span>
                       </span>
                     </div>
                   )}
                 </div>
                   );
                 })()}
               </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
