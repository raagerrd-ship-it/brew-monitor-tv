import { Logo } from "./Logo";
import { NotificationBell } from "./NotificationBell";
import { Clock } from "./Clock";
import { SonosWidget } from "./sonos/SonosWidget";
import { memo, useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Settings, Pill, AirVent, LogOut, RefreshCw, WifiOff, Timer, Snowflake, AlertTriangle, Menu, Cpu } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlarmTimerDialog } from "./AlarmTimerDialog";
import { useAlarmTimer } from "@/contexts/AlarmTimerContext";

import { useIsMobile } from "@/hooks";
import { useTvMode } from "@/contexts/TvModeContext";
import { TempController } from "@/types/brew";
import { DEFAULT_DEVICE_COLOR } from "@/lib/brew-utils";
import { supabase } from "@/integrations/supabase/client";
import { useRaptBarData } from "@/hooks/use-rapt-bar-data";
import { RaptControllerDialog } from "./RaptControllerDialog";
import { HeaderIconButton } from "./header/HeaderIconButton";

function PiMenuItem() {
  const [lastHeartbeat, setLastHeartbeat] = useState<string | null>(null);
  const [online, setOnline] = useState(false);

  useEffect(() => {
    let mounted = true;
    const evaluate = (hb: string | null) => {
      const isOnline = hb ? (Date.now() - new Date(hb).getTime()) / 1000 < 300 : false;
      setOnline((prev) => (prev === isOnline ? prev : isOnline));
    };
    const load = async () => {
      const { data } = await supabase
        .from("pi_live_state")
        .select("last_heartbeat")
        .order("last_heartbeat", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!mounted) return;
      setLastHeartbeat(data?.last_heartbeat ?? null);
      evaluate(data?.last_heartbeat ?? null);
    };
    load();
    const iv = setInterval(load, 30000);
    const tick = setInterval(() => evaluate(lastHeartbeat), 15000);
    return () => {
      mounted = false;
      clearInterval(iv);
      clearInterval(tick);
    };
  }, [lastHeartbeat]);

  const ageSec = lastHeartbeat ? (Date.now() - new Date(lastHeartbeat).getTime()) / 1000 : Infinity;
  return (
    <DropdownMenuItem disabled className="flex items-center justify-between opacity-100 cursor-default">
      <span className="flex items-center gap-2">
        <Cpu className="h-4 w-4" style={{ color: online ? "hsl(142 60% 55%)" : "hsl(0 70% 60%)" }} />
        Pi-status
      </span>
      <span className="text-xs" style={{ color: online ? "hsl(142 60% 55%)" : "hsl(0 70% 60%)" }}>
        {online ? `online (${Math.round(ageSec)}s)` : "offline"}
      </span>
    </DropdownMenuItem>
  );
}

const HEADER_HEIGHT_DESKTOP = 60;
const HEADER_HEIGHT_TV = 60;
const HEADER_HEIGHT = HEADER_HEIGHT_DESKTOP;
export { HEADER_HEIGHT, HEADER_HEIGHT_TV, HEADER_HEIGHT_DESKTOP };

interface DashboardHeaderProps {
  hasAlbumArtBackground?: boolean;
  onLogout?: () => void;
  onRefresh?: () => void;
}

export function DashboardHeader({
  hasAlbumArtBackground = false,
  onLogout,
  onRefresh,
}: DashboardHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const { isTvMode } = useTvMode();
  const isOnSettings = location.pathname === '/settings';

  // RAPT bar data — self-contained
  const { controllers, pills, piDisabled } = useRaptBarData();

  // Sonos visibility drives header layout: chips grow when Sonos is hidden.
  const [sonosVisible, setSonosVisible] = useState(true);

  // Alarm/Timer dialog state
  const [alarmDialogOpen, setAlarmDialogOpen] = useState(false);
  const { entry: alarmEntry } = useAlarmTimer();

  // Controller dialog state
  const [selectedController, setSelectedController] = useState<TempController | null>(null);
  const [selectedControllerIsCooler, setSelectedControllerIsCooler] = useState(false);
  const [controllerDialogOpen, setControllerDialogOpen] = useState(false);
  const [coolerControllerId, setCoolerControllerId] = useState<string | null>(null);

  useEffect(() => {
    const loadCoolerController = async () => {
      const { data } = await supabase.from('rapt_temp_controllers').select('controller_id').eq('is_glycol_cooler', true).limit(1).maybeSingle();
      if (data?.controller_id) setCoolerControllerId(data.controller_id);
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
        className={`z-20 ${isTvMode ? '' : 'transition-all duration-500'} ${isMobile ? 'flex flex-col py-2 px-2 gap-2 fixed top-0 left-0 right-0 overflow-visible' : 'flex-shrink-0 flex items-stretch relative overflow-hidden border-b border-border/30 bg-background/70'}`}
        style={{
          height: isMobile ? 'auto' : `${HEADER_HEIGHT_DESKTOP}px`,
          background: isMobile ? 'hsl(var(--background))' : undefined,
          borderBottom: isMobile ? '1px solid hsl(var(--border) / 0.6)' : undefined,
          backdropFilter: isMobile ? undefined : 'blur(18px)',
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
                <HeaderIconButton
                  icon={<RefreshCw />}
                  label="Uppdatera"
                  onClick={onRefresh}
                />
              )}
              <HeaderIconButton
                icon={<Timer />}
                label="Timer / alarm"
                onClick={() => setAlarmDialogOpen(true)}
                active={!!(alarmEntry && !alarmEntry.fired)}
                dotColor={
                  alarmEntry && !alarmEntry.fired
                    ? "hsl(var(--primary))"
                    : undefined
                }
              />
              <NotificationBell />
              <HeaderIconButton
                icon={<Settings />}
                label="Inställningar"
                onClick={() => navigate('/settings')}
                active={isOnSettings}
              />
            </div>
          </div>
        ) : null}

        {/* RAPT Section - Mobile */}
        {isMobile && controllers.length > 0 && (
          <RaptControllerBar controllers={controllers} pills={pills} piDisabled={piDisabled} onControllerClick={handleControllerClick} isMobile={true} isTvMode={isTvMode} compact={sonosVisible} />
        )}

        {/* Desktop: controllers left, Sonos center, actions + clock right */}
        {!isMobile && (
          <>
            <div className="flex items-stretch flex-1 min-w-0 overflow-hidden">
              {controllers.length > 0 && (
                <RaptControllerBar controllers={controllers} pills={pills} piDisabled={piDisabled} onControllerClick={handleControllerClick} isMobile={false} isTvMode={isTvMode} compact={sonosVisible} />
              )}
            </div>

            <div
              className={`flex items-stretch justify-center min-w-0 overflow-hidden border-l border-border/60 bg-muted/10 ${isTvMode && sonosVisible ? 'flex-1' : ''}`}
              style={{
                cursor: isTvMode ? 'default' : 'pointer',
                maxWidth: isTvMode ? (sonosVisible ? '300px' : '0px') : (sonosVisible ? '180px' : '0px'),
                opacity: sonosVisible ? 1 : 0,
                transition: 'max-width 400ms ease, opacity 300ms ease, flex 400ms ease',
              }}
              onClick={isTvMode ? undefined : () => navigate('/')}
            >
              <SonosWidget isMobile={false} variant="header" onVisibilityChange={setSonosVisible} />
            </div>

            <div className="flex items-center gap-1 flex-shrink-0 self-stretch border-l border-border/60 px-4">
              {!isTvMode && <NotificationBell />}

              {!isTvMode && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <div>
                      <HeaderIconButton
                        icon={<Menu />}
                        label="Meny"
                        active={isOnSettings || !!(alarmEntry && !alarmEntry.fired)}
                        dotColor={
                          alarmEntry && !alarmEntry.fired
                            ? "hsl(var(--primary))"
                            : undefined
                        }
                      />
                    </div>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <PiMenuItem />
                    <DropdownMenuItem onClick={() => setAlarmDialogOpen(true)}>
                      <Timer className="mr-2 h-4 w-4" />
                      Timer / alarm
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate('/settings')}>
                      <Settings className="mr-2 h-4 w-4" />
                      Inställningar
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {!isTvMode && <div className="self-center h-8 w-px mx-2 flex-shrink-0 bg-border/60" />}
              <Clock />
            </div>
          </>
        )}
      </div>

      {/* Alarm/Timer dialog */}
      <AlarmTimerDialog open={alarmDialogOpen} onOpenChange={setAlarmDialogOpen} />

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
  piDisabled?: Record<string, boolean>;
  compact?: boolean;
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
  piDisabled = {},
  compact = false,
}: RaptControllerBarProps) {
  const [now, setNow] = useState(() => Date.now());
  const [staleThresholdMin, setStaleThresholdMin] = useState(31);
  const [pillStaleMin, setPillStaleMin] = useState(5);
  const [probeStaleMin, setProbeStaleMin] = useState(31);

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

  // Load sensor freshness thresholds. Controller data now comes from the Pi.
  useEffect(() => {
    const check = async () => {
      const { data } = await supabase
        .from('sync_settings')
        .select('rapt_sync_interval, pill_stale_threshold_min, probe_stale_threshold_min')
        .limit(1)
        .maybeSingle();
      if (!data) return;
      const syncIntervalSec = (data as any).rapt_sync_interval ?? 300;
      const thresholdMin = Math.max(31, Math.round((syncIntervalSec * 2) / 60) + 20);
      setStaleThresholdMin(thresholdMin);
      setPillStaleMin(Number((data as any).pill_stale_threshold_min ?? 5));
      setProbeStaleMin(Number((data as any).probe_stale_threshold_min ?? 31));
    };
    check();
    const interval = setInterval(check, 60000);
    return () => clearInterval(interval);
  }, [controllers]);

  // Tick every 30s to keep duration updated
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  return (
      <div className="w-full">
      <div className="relative w-full">
        <div className={`flex items-stretch justify-start gap-0 scrollbar-hide w-full h-full ${isMobile ? 'overflow-x-auto' : 'bg-muted/10 rounded-md border border-border/20'}`} style={{
          background: 'transparent',
          WebkitOverflowScrolling: isMobile ? 'touch' : undefined,
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
          {controllers.map((controller) => {
            const linkedPill = pills.find(p => p.pill_id === controller.linked_pill_id);
            const controllerColor = linkedPill?.color && linkedPill.color !== '#000000' ? linkedPill.color : DEFAULT_DEVICE_COLOR;
            const isPillStale = linkedPill?.last_update ? (new Date().getTime() - new Date(linkedPill.last_update).getTime()) / (1000 * 60 * 60) > 24 : true;
            return (() => {
                    const controllerStaleMin = controller.last_update ? (now - new Date(controller.last_update).getTime()) / 60000 : 0;
                    const isControllerStale = controllerStaleMin > staleThresholdMin;
                    const batteryLevel = linkedPill ? Math.floor(linkedPill.battery_level) : 0;
                    const batteryColor = batteryLevel < 20 ? 'hsl(0 70% 50%)' : controllerColor;
                    const pillAgeMin = linkedPill?.last_update
                      ? (now - new Date(linkedPill.last_update).getTime()) / 60000
                      : Infinity;
                    const probeStamp = (controller as any).current_temp_updated_at ?? controller.last_update;
                    const probeAgeMin = probeStamp
                      ? (now - new Date(probeStamp).getTime()) / 60000
                      : Infinity;
                    const pillStale = !!linkedPill && pillAgeMin > pillStaleMin;
                    const probeStale = controller.current_temp != null && probeAgeMin > probeStaleMin;
                    const pillWarn = pillStale || probeStale;
                    const pillTempVal = (controller as any).pill_temp != null ? Number((controller as any).pill_temp) : null;
                    const probeTempVal = controller.current_temp != null ? Number(controller.current_temp) : null;
                    const displayTemp = controller.actual_temp ?? (
                      pillTempVal != null && probeTempVal != null
                        ? (pillTempVal + probeTempVal) / 2
                        : (probeTempVal ?? pillTempVal)
                    );
                    const isCooler = controller.is_glycol_cooler;
                    const isOff = piDisabled[controller.controller_id] === true;
                    const hasPill = !!linkedPill && !isPillStale;
                    const pillActive = !isOff && hasPill;
                    const probeActive = !isOff && controller.current_temp != null;
                    const accent = isCooler ? 'hsl(200 70% 60%)' : controllerColor;
                    return (
                  <div
                    key={controller.id}
                    className={`relative flex flex-col justify-center overflow-hidden flex-shrink-0 border-r border-border/30 bg-transparent ${isTvMode ? '' : 'cursor-pointer hover:bg-white/[0.03]'}`}
                    style={{
                      flex: isMobile ? undefined : '1 1 0%',
                      width: isMobile
                        ? (isCooler ? (compact ? '118px' : '142px') : (compact ? '142px' : '172px'))
                        : undefined,
                      minWidth: isMobile
                        ? undefined
                        : (isCooler ? (compact ? '120px' : '150px') : (compact ? '150px' : '180px')),
                      height: isMobile ? (compact ? '48px' : '54px') : (compact ? '52px' : '60px'),
                      padding: isMobile ? (compact ? '3px 10px 7px' : '4px 12px 8px') : (compact ? '4px 14px 8px' : '5px 18px 9px'),
                      transition: 'flex 400ms ease, width 400ms ease, height 400ms ease, padding 400ms ease, background-color 200ms ease',
                    }}
                    onClick={isTvMode ? undefined : () => onControllerClick(controller)}
                    title={!isMobile && !isTvMode ? `${controller.name}\nInbyggd: ${controller.current_temp !== null ? controller.current_temp.toFixed(1) : '--'}°${controller.pill_temp !== null ? `\nPill: ${controller.pill_temp.toFixed(1)}°` : ''}\nMål: ${controller.target_temp !== null ? controller.target_temp.toFixed(1) : '--'}°${isControllerStale ? `\n\n⚠️ Ingen data på ${formatDuration(now - new Date(controller.last_update!).getTime())}` : ''}\n\nKlicka för att ändra inställningar` : undefined}
                  >
                    {/* Label row */}
                    <div className="flex items-center justify-between gap-1">
                      <span className="uppercase font-bold truncate" style={{
                        fontSize: '10px',
                        letterSpacing: '0.1em',
                        color: isCooler ? 'hsl(200 70% 65%)' : 'hsl(var(--muted-foreground))',
                      }}>
                        {isCooler ? 'Glykol' : (linkedPill?.name || controller.name)}
                      </span>
                      <span className="flex items-center gap-1.5 flex-shrink-0" title={isOff ? `${controller.name} är avstängd` : undefined}>
                        {isControllerStale && (
                          <WifiOff className="w-3 h-3 text-destructive animate-pulse" />
                        )}
                        {!isControllerStale && pillWarn && (
                          <span
                            className="inline-flex"
                            title={[
                              pillStale ? `Pill: ${Math.round(pillAgeMin)} min sedan uppdatering (tröskel ${pillStaleMin} min)` : '',
                              probeStale ? `Probe: ${Math.round(probeAgeMin)} min sedan uppdatering (tröskel ${probeStaleMin} min)` : '',
                            ].filter(Boolean).join('\n')}
                          >
                            <AlertTriangle
                              className="w-3 h-3 flex-shrink-0"
                              style={{ color: 'hsl(38 92% 55%)', filter: 'drop-shadow(0 0 2px hsl(38 92% 55% / 0.35))' }}
                            />
                          </span>
                        )}
                        {!isControllerStale && isCooler && (
                          <Snowflake style={{ width: '0.75rem', height: '0.75rem', color: 'hsl(200 70% 60%)', filter: 'drop-shadow(0 0 2px hsl(200 70% 60% / 0.35))' }} />
                        )}
                        {!isControllerStale && !isCooler && (
                          <>
                            <Pill style={{
                              width: '0.75rem',
                              height: '0.75rem',
                              opacity: pillActive ? 1 : 0.15,
                              color: pillActive ? controllerColor : 'currentColor',
                              filter: pillActive ? `drop-shadow(0 0 2px ${controllerColor}60)` : 'none',
                            }} strokeWidth={2} />
                            <AirVent style={{
                              width: '0.75rem',
                              height: '0.75rem',
                              opacity: probeActive ? 0.9 : 0.15,
                              color: probeActive ? controllerColor : 'currentColor',
                              filter: probeActive ? `drop-shadow(0 0 2px ${controllerColor}60)` : 'none',
                            }} />
                          </>
                        )}
                      </span>
                    </div>

                    {/* Temp row */}
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-bold whitespace-nowrap" style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: isMobile ? '17px' : '22px',
                        lineHeight: 1.05,
                        color: isControllerStale ? 'hsl(0 0% 95%)' : accent,
                        textShadow: isControllerStale ? 'none' : `0 0 10px ${accent}55`,
                      }}>
                        {displayTemp !== null ? `${displayTemp.toFixed(1)}°` : '--°'}
                      </span>
                      {controller.target_temp !== null && (
                        <span className="whitespace-nowrap" style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: isMobile ? '13px' : '15px',
                          color: 'hsl(var(--muted-foreground))',
                          opacity: 0.95,
                        }}>
                          › {controller.target_temp.toFixed(1)}°
                        </span>
                      )}
                    </div>

                    {/* Bottom accent bar (battery) */}
                    {linkedPill && (
                      <div className="absolute bottom-0 left-0 right-0" style={{
                        height: '2px',
                        background: 'hsl(var(--muted) / 0.35)',
                      }}>
                        <div
                          className="absolute top-0 bottom-0 left-0 transition-all duration-500"
                          style={{
                            width: `${Math.max(batteryLevel, 1)}%`,
                            background: batteryColor,
                            opacity: 0.8,
                            boxShadow: `0 0 3px ${batteryColor}80`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                    );
                  })();
          })}
        </div>
      </div>
    </div>
  );
});
