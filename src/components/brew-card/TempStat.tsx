import { memo } from "react";
import { BrewData } from "@/types/brew";
import { DeviceMatch } from "./types";
import { isBrewInactive } from "./utils";
import { StatCard } from "./StatCard";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getActualTempLabel, getDisplayTarget } from "@/lib/temp-display";


interface TempStatProps {
  brew: BrewData;
  devices: DeviceMatch;
  updatedFields: Record<string, Record<string, boolean>>;
  onControllerClick?: (controller: import("@/types/brew").TempController) => void;
}

function TempStatComponent({ brew, devices, updatedFields, onControllerClick }: TempStatProps) {
  const { pill, controller } = devices;
  const isInactive = isBrewInactive(brew.status);

  // Detect stale pill data (>30 minutes old)
  const pillLastUpdate = pill?.last_update ? new Date(pill.last_update).getTime() : 0;
  const isPillStale = pill ? (Date.now() - pillLastUpdate > 30 * 60 * 1000) : true;

  // Pill temp: prefer controller's pill_temp (synced with RAPT, always fresh when controller is online)
  // Fall back to brew.currentTemp from pill if available
  const pillTemp = controller?.pill_temp ?? ((pill && !isPillStale) ? brew.currentTemp : null);
  const probeTemp = controller?.current_temp ?? null;
  // SSOT: use controller's dual_sensor_enabled flag for dual-sensor fusion
  const pillCompEnabled = (controller as any)?.dual_sensor_enabled ?? false;
  // SSOT: prefer pre-calculated actual_temp from controller (fusion/priority done in sync engine)
  const displayTemp = controller?.actual_temp ?? brew.currentTemp;
  const tempLabel = getActualTempLabel(pillTemp, probeTemp, pillCompEnabled);
  const tempColor = isPillStale && controller ? 'hsl(var(--primary))' : (pill?.color || 'hsl(var(--primary))');
  const showStaleWarning = pill && isPillStale && !isInactive;

  // Calculate delta: pill (surface) - controller (core)
  const hasBothSensors = pillTemp !== null && probeTemp !== null;
  const delta = hasBothSensors ? pillTemp - probeTemp : null;

  // Overshoot detection: pill >= target AND controller < target (heater is pushing, pill overshooting)
  const targetTemp = controller?.target_temp;
  const surfaceTemp = brew.currentTemp;
  const ctrlTemp = controller?.current_temp;
  const isOvershoot = !isInactive && targetTemp !== null && targetTemp !== undefined
    && ctrlTemp !== null && ctrlTemp !== undefined
    && surfaceTemp >= targetTemp + 0.3
    && (delta ?? 0) > 2.0;

  // Overshoot data now comes pre-fetched from the hook (no per-card DB query)
  const overshootReason = brew.overshootReason;
  const originalTarget = brew.originalTarget;


  // SSOT: centralized target temp calculation
  // Read profile_target_temp from controller directly (SSOT for both manual and profile modes)
  const currentProfileTarget = controller?.profile_target_temp
    ?? brew.fermentationSession?.controller_profile_target_temp
    ?? null;
  const { actualTarget: displayTarget, pidCompensation: compensation } = getDisplayTarget(
    currentProfileTarget,
    targetTemp
  );
  const profileTarget = currentProfileTarget;
  const showBothTargets = compensation !== null && Math.abs(compensation) >= 0.1;
  
  const profileGoal = displayTarget?.toFixed(1);
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
    tooltipParts.push(`Pill: ${brew.currentTemp.toFixed(1)}°${isPillStale ? ' ⚠ gammal' : ''}`);
  }
  if (delta !== null && !isPillStale) {
    tooltipParts.push(`Delta: ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}°`);
  }
  if (showStaleWarning) {
    const minutesAgo = Math.round((Date.now() - pillLastUpdate) / 60000);
    tooltipParts.push(`Pill offline ${minutesAgo}min — visar probe`);
  }

  const handleClick = controller && onControllerClick 
    ? () => onControllerClick(controller) 
    : undefined;

  // Temperature span bar: visual range showing sensor(s) relative to target
  const hasAnySensor = (pillTemp !== null || probeTemp !== null);
  const spanBar = hasAnySensor && !isInactive && targetTemp !== null && targetTemp !== undefined ? (() => {
    const pTemp = pillTemp;       // pill (surface) — may be null
    const cTemp = probeTemp;      // controller (core) — may be null
    const profileT = profileTarget ?? targetTemp;
    const compensatedT = targetTemp;
    
    // Fixed range: profile target ±3°
    const rangeMin = profileT - 3;
    const rangeMax = profileT + 3;
    const range = rangeMax - rangeMin;
    
    const pct = (t: number) => Math.max(2, Math.min(98, ((t - rangeMin) / range) * 100));
    
    const ctrlPct = cTemp !== null ? pct(cTemp) : null;
    const pillPct = pTemp !== null ? pct(pTemp) : null;
    const profilePct = pct(profileT);
    const compensatedPct = pct(compensatedT);
    
    // Span bar: if both sensors, show range; if single, show a thin marker
    const hasBoth = ctrlPct !== null && pillPct !== null;
    const leftPct = hasBoth ? Math.min(ctrlPct, pillPct) : (ctrlPct ?? pillPct!);
    const rightPct = hasBoth ? Math.max(ctrlPct, pillPct) : leftPct;
    
    const showCompensatedMarker = Math.abs(profileT - compensatedT) >= 0.1;

    // Scale labels
    const leftLabel = cTemp !== null ? `${cTemp.toFixed(1)}°` : `${(pTemp!).toFixed(1)}°`;
    const rightLabel = hasBoth ? `${pTemp!.toFixed(1)}°` : '';
    const centerLabel = hasBoth
      ? `Δ ${delta !== null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}°` : '—'}`
      : (cTemp !== null ? 'Probe' : 'Pill');

    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="w-full flex flex-col gap-0.5 cursor-help">
              {/* Bar */}
              <div className="w-full px-1">
                <div 
                  className="w-full rounded-full overflow-hidden relative"
                  style={{ 
                    height: '6px',
                    background: 'hsl(0 0% 0% / 0.5)',
                    boxShadow: 'inset 0 2px 4px hsl(0 0% 0% / 0.6), inset 0 -1px 0 hsl(0 0% 100% / 0.05)'
                  }}
                >
                  {/* Colored span bar */}
                  <div 
                    className="absolute h-full rounded-full"
                    style={{ 
                      left: `${leftPct}%`, 
                      width: `${Math.max(rightPct - leftPct, 2)}%`,
                      background: hasBoth
                        ? `linear-gradient(90deg, hsl(var(--temp-blue) / 0.8), ${isOvershoot ? 'hsl(38 92% 50% / 0.8)' : 'hsl(var(--ferment-green) / 0.7)'})`
                        : (cTemp !== null ? 'hsl(var(--temp-blue) / 0.8)' : 'hsl(var(--ferment-green) / 0.7)'),
                    }} 
                  />
                  {/* Glass highlight */}
                  <div 
                    className="absolute inset-0 rounded-full pointer-events-none"
                    style={{ background: 'linear-gradient(180deg, hsl(0 0% 100% / 0.2) 0%, transparent 40%)' }}
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
                  {/* Compensated target marker (dashed yellow) */}
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
                  {/* Display temp dot */}
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
              {/* Scale labels */}
              <div className="flex justify-between text-muted-foreground/60 tabular-nums" style={{ fontSize: '9px' }}>
                <span>{leftLabel}</span>
                <span className="text-muted-foreground/40">{centerLabel}</span>
                <span>{rightLabel}</span>
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <div className="space-y-0.5">
              {cTemp !== null && <p><span style={{ color: 'hsl(var(--temp-blue))' }}>●</span> Controller: {cTemp.toFixed(1)}°</p>}
              {pTemp !== null && <p><span style={{ color: 'hsl(var(--ferment-green))' }}>●</span> Pill: {pTemp.toFixed(1)}°</p>}
              <p><span style={{ color: 'hsl(38 92% 50%)' }}>│</span> Profilmål: {profileT.toFixed(1)}°</p>
              {showCompensatedMarker && (
                <p><span style={{ color: 'hsl(38 92% 50% / 0.7)' }}>┊</span> Kompenserat: {compensatedT.toFixed(1)}°</p>
              )}
              {hasBoth && <p><span style={{ color: 'hsl(var(--foreground) / 0.7)' }}>│</span> Snitt: {displayTemp.toFixed(1)}°</p>}
              {isOvershoot && <p style={{ color: 'hsl(38 92% 50%)' }}>⚠ Overshoot</p>}
              {overshootReason && <p className="text-foreground border-t border-border pt-0.5 mt-0.5"><span className="font-medium">AI:</span> {overshootReason}</p>}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  })() : null;

  // PWM Duty Cycle bar — show for all active controllers (default 0% when no data)
  const effectiveDutyPct = brew.dutyPct ?? (controller && !isInactive ? 0 : null);
  const dutyBar = effectiveDutyPct !== null ? (() => {
    const duty = effectiveDutyPct;
    const mode = brew.dutyMode;
    const isCooling = mode === 'cooling';
    const barColor = isCooling ? 'hsl(var(--temp-blue))' : 'hsl(0 70% 50%)';

    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="w-full flex flex-col gap-0.5 cursor-help">
              <div className="w-full px-1">
                <div 
                  className="w-full rounded-full overflow-hidden relative"
                  style={{ 
                    height: '6px',
                    background: 'hsl(0 0% 0% / 0.5)',
                    boxShadow: 'inset 0 2px 4px hsl(0 0% 0% / 0.6), inset 0 -1px 0 hsl(0 0% 100% / 0.05)'
                  }}
                >
                  {/* Filled bar from 0 to duty% */}
                  <div 
                    className="absolute top-0 bottom-0 left-0 rounded-full"
                    style={{ 
                      width: `${Math.max(duty, 1)}%`,
                      background: barColor,
                      opacity: 0.7,
                      boxShadow: `0 0 8px ${barColor}`,
                    }} 
                  />
                  {/* Glass highlight */}
                  <div 
                    className="absolute inset-0 rounded-full pointer-events-none"
                    style={{ background: 'linear-gradient(180deg, hsl(0 0% 100% / 0.2) 0%, transparent 40%)' }}
                  />
                  {/* Marker dot at duty position */}
                  {duty > 0 && (
                    <div 
                      className="absolute rounded-full"
                      style={{ 
                        left: `${duty}%`, 
                        top: '50%',
                        width: '6px',
                        height: '6px',
                        background: barColor,
                        transform: 'translate(-3px, -50%)',
                        boxShadow: `0 0 6px ${barColor}`,
                      }} 
                    />
                  )}
                </div>
              </div>
              {/* Scale labels */}
              <div className="flex justify-between text-muted-foreground/60 tabular-nums" style={{ fontSize: '9px' }}>
                <span>0%</span>
                <span style={{ color: barColor }}>PWM {duty}%</span>
                <span>100%</span>
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs max-w-[260px]">
            <div className="space-y-0.5">
              <p className="font-medium">PWM Duty: {duty}% — {isCooling ? 'Kylning' : 'Värmning'}</p>
              {(() => {
                const reason = brew.pidReason;
                if (!reason) return null;
                const piMatch = reason.match(/PI=([+-]?\d+\.?\d*)°C\(P=([+-]?\d+\.?\d*),I=([+-]?\d+\.?\d*)/);
                const deltaMatch = reason.match(/delta=([+-]?\d+\.?\d*)/);
                const learnedMatch = reason.match(/learned=([+-]?\d+\.?\d*)\[([^\]]+)\]n=(\d+)/);
                
                return (
                  <>
                    <div className="border-t border-border/50 my-1" />
                    {deltaMatch && <p>Delta (pill−probe): {deltaMatch[1]}°</p>}
                    {piMatch && (
                      <p>PI-korrigering: {piMatch[1]}° <span className="text-muted-foreground">(P={piMatch[2]}, I={piMatch[3]})</span></p>
                    )}
                    {learnedMatch && (
                      <p>Inlärd baseline: {learnedMatch[1]}° <span className="text-muted-foreground">[{learnedMatch[2]}] n={learnedMatch[3]}</span></p>
                    )}
                  </>
                );
              })()}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  })() : null;

  const [displayTempWhole, displayTempDecimals = '00'] = displayTemp.toFixed(2).split('.');
  const displayTempMain = `${displayTempWhole}.${displayTempDecimals[0] ?? '0'}`;
  const displayTempMuted = displayTempDecimals[1] ?? '0';

  return (
    <StatCard
      label={label}
      value={<span className="tabular-nums">{displayTempMain}<span className="text-muted-foreground/40">{displayTempMuted}°</span></span>}
      
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
        {spanBar}
        {dutyBar}
      </div>
    </StatCard>
  );
}
export const TempStat = memo(TempStatComponent);
