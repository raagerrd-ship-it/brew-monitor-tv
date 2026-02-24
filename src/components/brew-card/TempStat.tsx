import { memo } from "react";
import { BrewData } from "@/types/brew";
import { DeviceMatch } from "./types";
import { isBrewInactive } from "./utils";
import { StatCard } from "./StatCard";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface TempStatProps {
  brew: BrewData;
  devices: DeviceMatch;
  updatedFields: Record<string, Record<string, boolean>>;
  onControllerClick?: (controller: import("@/types/brew").TempController) => void;
}

function TempStatComponent({ brew, devices, updatedFields, onControllerClick }: TempStatProps) {
  const { pill, controller } = devices;
  const tempColor = pill?.color || 'hsl(var(--primary))';
  const isInactive = isBrewInactive(brew.status);

  // Use average of pill and controller if both available, otherwise fallback
  const hasBothForAvg = controller?.current_temp !== null && controller?.current_temp !== undefined && pill;
  const displayTemp = hasBothForAvg 
    ? (controller.current_temp! + brew.currentTemp) / 2 
    : controller?.current_temp ?? brew.currentTemp;

  // Calculate delta: pill (surface) - controller (core)
  const hasBothSensors = pill && controller?.current_temp !== null && controller?.current_temp !== undefined;
  const delta = hasBothSensors ? brew.currentTemp - controller.current_temp! : null;

  // Overshoot detection: pill >= target AND controller < target (heater is pushing, pill overshooting)
  const targetTemp = controller?.target_temp;
  const pillTemp = brew.currentTemp;
  const ctrlTemp = controller?.current_temp;
  const isOvershoot = !isInactive && targetTemp !== null && targetTemp !== undefined
    && ctrlTemp !== null && ctrlTemp !== undefined
    && pillTemp >= targetTemp + 0.3
    && (delta ?? 0) > 2.0;

  // Overshoot data now comes pre-fetched from the hook (no per-card DB query)
  const overshootReason = brew.overshootReason;
  const originalTarget = brew.originalTarget;


  // Calculate the current profile target (interpolated during ramps)
  // Falls back through previous steps to find the most recent target_temp
  const currentProfileTarget = (() => {
    const session = brew.fermentationSession;
    if (!session?.steps?.length) return null;
    
    const stepIdx = session.current_step_index;
    const step = session.steps[stepIdx];
    if (!step) return null;
    
    const stepTarget = step.target_temp;
    
    // During a ramp with duration, interpolate between start temp and target
    if (step.step_type === 'ramp' && step.duration_hours && session.step_start_temp != null && stepTarget != null) {
      const elapsed = (Date.now() - new Date(session.step_started_at).getTime()) / (1000 * 60 * 60);
      const progress = Math.min(elapsed / step.duration_hours, 1);
      return Math.round((session.step_start_temp + (stepTarget - session.step_start_temp) * progress) * 10) / 10;
    }
    
    if (stepTarget != null) return stepTarget;
    
    // Current step has no target_temp (e.g. wait steps) — look back through previous steps
    for (let i = stepIdx - 1; i >= 0; i--) {
      if (session.steps[i]?.target_temp != null) {
        return session.steps[i].target_temp;
      }
    }
    
    return null;
  })();

  // Show both targets if profile target differs from current (auto-adjusted)
  const profileTarget = currentProfileTarget ?? originalTarget;
  const showBothTargets = profileTarget !== null && targetTemp !== null && targetTemp !== undefined
    && Math.abs(profileTarget - targetTemp) >= 0.1;
  
  const profileGoal = profileTarget?.toFixed(1);
  const label: React.ReactNode = profileGoal
    ? <>Temp <span className="text-muted-foreground/50">({profileGoal}°)</span></>
    : targetTemp !== null && targetTemp !== undefined
      ? <>Temp <span className="text-muted-foreground/50">({targetTemp.toFixed(1)}°)</span></>
      : 'Temp';

  // Build tooltip text showing temp source
  const tooltipParts: string[] = [];
  if (controller?.current_temp !== null && controller?.current_temp !== undefined) {
    tooltipParts.push(`Inbyggd: ${controller.current_temp.toFixed(1)}°`);
  }
  if (pill) {
    tooltipParts.push(`Pill: ${brew.currentTemp.toFixed(1)}°`);
  }
  if (delta !== null) {
    tooltipParts.push(`Delta: ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}°`);
  }

  const handleClick = controller && onControllerClick 
    ? () => onControllerClick(controller) 
    : undefined;

  // Temperature span bar: visual range showing pill↔controller with target marker
  const spanBar = hasBothSensors && !isInactive && targetTemp !== null && targetTemp !== undefined ? (() => {
    const pTemp = brew.currentTemp;       // pill (surface)
    const cTemp = controller.current_temp!; // controller (core)
    const profileT = profileTarget ?? targetTemp; // Profilmål (originalmål)
    const compensatedT = targetTemp; // Pill-kompenserat controllermål
    
    // Fixed range: profile target ±3°
    const rangeMin = profileT - 3;
    const rangeMax = profileT + 3;
    const range = rangeMax - rangeMin;
    
    const pct = (t: number) => Math.max(2, Math.min(98, ((t - rangeMin) / range) * 100));
    
    const ctrlPct = pct(cTemp);
    const pillPct = pct(pTemp);
    const profilePct = pct(profileT);
    const compensatedPct = pct(compensatedT);
    const leftPct = Math.min(ctrlPct, pillPct);
    const rightPct = Math.max(ctrlPct, pillPct);
    
    const showCompensatedMarker = Math.abs(profileT - compensatedT) >= 0.1;

    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="w-full cursor-help" style={{ height: '10px', display: 'flex', alignItems: 'center' }}>
              {/* Track background – full ±3° range */}
              <div className="relative w-full h-[6px] rounded-full" style={{ background: 'hsl(var(--muted) / 0.6)' }}>
                {/* Colored span bar from ctrl to pill */}
                <div 
                  className="absolute h-full rounded-full"
                  style={{ 
                    left: `${leftPct}%`, 
                    width: `${Math.max(rightPct - leftPct, 2)}%`,
                    background: `linear-gradient(90deg, hsl(var(--temp-blue) / 0.8), ${isOvershoot ? 'hsl(38 92% 50% / 0.8)' : 'hsl(var(--ferment-green) / 0.7)'})`,
                  }} 
                />
                {/* Profile target marker (solid yellow) */}
                <div 
                  className="absolute rounded-sm"
                  style={{ 
                    left: `${profilePct}%`, 
                    top: '-3px',
                    width: '2px',
                    height: '12px',
                    background: 'hsl(38 92% 50%)',
                    transform: 'translateX(-1px)',
                    boxShadow: '0 0 6px hsl(38 92% 50% / 0.6)',
                  }} 
                />
                {/* Compensated target marker (dashed yellow) - only if different from profile */}
                {showCompensatedMarker && (
                  <div 
                    className="absolute"
                    style={{ 
                      left: `${compensatedPct}%`, 
                      top: '-4px',
                      width: '2px',
                      height: '14px',
                      backgroundImage: 'repeating-linear-gradient(to bottom, hsl(38 92% 50% / 0.9), hsl(38 92% 50% / 0.9) 2px, transparent 2px, transparent 4px)',
                      transform: 'translateX(-1px)',
                      boxShadow: '0 0 4px hsl(38 92% 50% / 0.4)',
                    }} 
                  />
                )}
                {/* Average temp dot – shows where the big displayed number sits on the scale */}
                <div 
                  className="absolute rounded-full"
                  style={{ 
                    left: `${pct(displayTemp)}%`, 
                    top: '50%',
                    width: '6px',
                    height: '6px',
                    background: 'hsl(var(--foreground))',
                    transform: 'translate(-3px, -50%)',
                    boxShadow: '0 0 4px hsl(var(--foreground) / 0.5)',
                  }} 
                />
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <div className="space-y-0.5">
              <p><span style={{ color: 'hsl(var(--temp-blue))' }}>●</span> Controller: {cTemp.toFixed(1)}°</p>
              <p><span style={{ color: 'hsl(var(--ferment-green))' }}>●</span> Pill: {pTemp.toFixed(1)}°</p>
              <p><span style={{ color: 'hsl(38 92% 50%)' }}>│</span> Profilmål: {profileT.toFixed(1)}°</p>
              {showCompensatedMarker && (
                <p><span style={{ color: 'hsl(38 92% 50% / 0.7)' }}>┊</span> Kompenserat: {compensatedT.toFixed(1)}°</p>
              )}
              <p><span style={{ color: 'hsl(var(--foreground) / 0.7)' }}>│</span> Snitt: {displayTemp.toFixed(1)}°</p>
              {isOvershoot && <p style={{ color: 'hsl(38 92% 50%)' }}>⚠ Overshoot</p>}
              {overshootReason && <p className="text-foreground border-t border-border pt-0.5 mt-0.5"><span className="font-medium">AI:</span> {overshootReason}</p>}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  })() : null;

  // PID compensation bar
  const pidBar = !isInactive && profileTarget !== null && targetTemp !== null && targetTemp !== undefined ? (() => {
    const compensation = targetTemp - profileTarget;
    const clampedComp = Math.max(-2, Math.min(2, compensation));
    const compensationPct = ((clampedComp + 2) / 4) * 100;
    const centerPct = 50;
    const isNeg = compensation < 0;
    const barLeft = isNeg ? compensationPct : centerPct;
    const barWidth = Math.abs(compensationPct - centerPct);
    const barColor = isNeg ? 'hsl(var(--temp-blue))' : 'hsl(38 92% 50%)';

    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="w-full flex flex-col gap-0.5 cursor-help">
              <div className="relative w-full" style={{ height: '6px' }}>
                <div 
                  className="absolute inset-0 rounded-full overflow-hidden"
                  style={{ 
                    background: 'hsl(0 0% 0% / 0.5)',
                    boxShadow: 'inset 0 2px 4px hsl(0 0% 0% / 0.6), inset 0 -1px 0 hsl(0 0% 100% / 0.05)'
                  }}
                >
                  {/* Filled bar from center to compensation */}
                  <div 
                    className="absolute top-0 bottom-0 rounded-full"
                    style={{ 
                      left: `${barLeft}%`, 
                      width: `${Math.max(barWidth, 1)}%`,
                      background: barColor,
                      boxShadow: `0 0 8px ${barColor}`,
                    }} 
                  />
                  {/* Glass highlight */}
                  <div 
                    className="absolute inset-0 rounded-full pointer-events-none"
                    style={{ background: 'linear-gradient(180deg, hsl(0 0% 100% / 0.2) 0%, transparent 40%)' }}
                  />
                </div>
                {/* Center line */}
                <div 
                  className="absolute top-[-1px] bottom-[-1px] w-[1px]"
                  style={{ left: '50%', background: 'hsl(0 0% 100% / 0.3)' }}
                />
                {/* Marker dot */}
                <div 
                  className="absolute rounded-full"
                  style={{ 
                    left: `${compensationPct}%`, 
                    top: '50%',
                    width: '6px',
                    height: '6px',
                    background: barColor,
                    transform: 'translate(-3px, -50%)',
                    boxShadow: `0 0 6px ${barColor}`,
                  }} 
                />
              </div>
              {/* Scale labels */}
              <div className="flex justify-between text-muted-foreground/60 tabular-nums" style={{ fontSize: '9px' }}>
                <span>-2.0</span>
                <span className="text-muted-foreground/40">PID {compensation >= 0 ? '+' : ''}{compensation.toFixed(1)}°</span>
                <span>+2.0</span>
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Kompensation: {compensation >= 0 ? '+' : ''}{compensation.toFixed(1)}°
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  })() : null;

  return (
    <StatCard
      label={label}
      value={<span style={{ marginTop: '-6px', display: 'block' }}>{`${displayTemp.toFixed(1)}°`}</span>}
      
      className="gap-0.5 !py-1.5"
      color={isOvershoot ? 'hsl(38 92% 50%)' : tempColor}
      isUpdated={updatedFields[brew.batch_id]?.temp}
      isInactive={isInactive}
      title={tooltipParts.length > 0 ? tooltipParts.join(' | ') : undefined}
      rowSpan={2}
      labelSize="18px"
      valueSize="48px"
      onClick={handleClick}
      clickable={!!handleClick}
    >
      <div className="z-10 text-center px-2 w-full flex flex-col min-h-0 gap-1 mt-1">
        {pidBar}
        {spanBar}
      </div>
    </StatCard>
  );
}
export const TempStat = memo(TempStatComponent);
