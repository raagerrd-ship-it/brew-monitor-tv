import { memo } from "react";
import { BrewData } from "@/types/brew";
import { DeviceMatch } from "./types";
import { isBrewInactive } from "./utils";
import { StatCard, MiniBar, statDetailClass } from "./StatCard";
import { RollingNumber } from "@/components/RollingNumber";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tv-tooltip";
import { getActualTempLabel, getDisplayTarget } from "@/lib/temp-display";


interface TempStatProps {
  brew: BrewData;
  devices: DeviceMatch;
  updatedFields: Record<string, Record<string, boolean>>;
  onControllerClick?: (controller: import("@/types/brew").TempController) => void;
  compact?: boolean;
}

function TempStatComponent({ brew, devices, updatedFields, onControllerClick, compact = false }: TempStatProps) {
  const { pill, controller } = devices;
  const isInactive = isBrewInactive(brew.status);

  // Alla tre temperaturerna och deras tidsstämpel kommer från Pi:ns 30 s-synk.
  const pillLastUpdate = controller?.last_update ? new Date(controller.last_update).getTime() : 0;
  const isPillStale = controller ? (Date.now() - pillLastUpdate > 30 * 60 * 1000) : true;

  // Pi:n skickar tre temperaturer var 30:e sekund: pill, PT100 och fusionen.
  // Molnet visar dem rakt av — ingen fallback, inget givarval här.
  const pillTemp = controller?.pill_temp ?? null;
  const probeTemp = controller?.pt100_temp ?? null;
  const displayTemp = brew.frozen ? brew.currentTemp : controller?.actual_temp ?? null;
  const tempLabel = getActualTempLabel(pillTemp, probeTemp, true);
  const tempColor = isPillStale && controller ? 'hsl(var(--primary))' : (pill?.color || 'hsl(var(--primary))');
  const showStaleWarning = controller && isPillStale && !isInactive;

  // Calculate delta: pill (surface) - controller (core)
  const hasBothSensors = pillTemp !== null && probeTemp !== null;
  const delta = hasBothSensors ? pillTemp - probeTemp : null;

  // SSOT: Pi:ns måltemp = profile_target_temp. RAPT:s target_temp är föråldrad och används bara som fallback.
  const targetTemp = controller?.profile_target_temp ?? controller?.target_temp;
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
  const goalTemp = displayTarget ?? targetTemp ?? null;
  const fmtC = (t: number) => `${t.toFixed(1).replace('.', ',')}°`;

  // Build tooltip text showing temp source
  const tooltipParts: string[] = [];
  if (probeTemp !== null) {
    tooltipParts.push(`PT100: ${probeTemp.toFixed(1)}°`);
  }
  if (pillTemp !== null) {
    tooltipParts.push(`Pill: ${pillTemp.toFixed(1)}°${isPillStale ? ' ⚠ gammal' : ''}`);
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
    
    // Span bar: if both sensors, show range; if single, show a thin marker
    const hasBoth = ctrlPct !== null && pillPct !== null;
    const leftPct = hasBoth ? Math.min(ctrlPct, pillPct) : (ctrlPct ?? pillPct!);
    const rightPct = hasBoth ? Math.max(ctrlPct, pillPct) : leftPct;
    
    const showCompensatedMarker = Math.abs(profileT - compensatedT) >= 0.1;

    // Scale labels
    // Vänster = givaren (PT100, kärna), höger = pillen (yta); stapeln ligger på profilmål ±3°.
    const leftLabel = cTemp !== null ? fmtC(cTemp) : fmtC(pTemp!);
    const rightLabel = hasBoth ? fmtC(pTemp!) : '';

    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="w-full flex flex-col gap-0.5 cursor-help">
              <MiniBar
                from={hasBoth ? leftPct : leftPct - 1}
                to={hasBoth ? Math.max(rightPct, leftPct + 2) : leftPct + 1}
                color={isOvershoot ? 'hsl(38 92% 50%)' : 'hsl(var(--ferment-green))'}
                marker={profilePct}
              />
              <div className={statDetailClass}>
                <span>{leftLabel}</span>
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
              {hasBoth && displayTemp !== null && <p><span style={{ color: 'hsl(var(--foreground) / 0.7)' }}>│</span> Snitt: {displayTemp.toFixed(1)}°</p>}
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
            <div className="w-full flex items-center gap-1.5 cursor-help">
              <span className="text-[12px] text-muted-foreground/80 tabular-nums tracking-tight leading-none whitespace-nowrap">{mode === 'cooling' ? 'Kyla' : mode === 'heating' ? 'Värme' : 'Effekt'} {duty} %</span>
              <div className="flex-1"><MiniBar to={duty} color={barColor} /></div>
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

  return (
    <StatCard
      label="Temp"
      value={displayTemp === null ? '—' : <RollingNumber value={displayTemp} decimals={1} suffix={<span className="text-muted-foreground/40">°</span>} />}
      
      className="gap-0.5 !py-1.5 !px-1.5"
      color={isOvershoot ? 'hsl(38 92% 50%)' : tempColor}
      isUpdated={updatedFields[brew.batch_id]?.temp}
      isInactive={isInactive}
      title={tooltipParts.length > 0 ? tooltipParts.join(' | ') : undefined}
      rowSpan={2}
      labelSize="18px"
      valueSize={compact ? "38px" : "48px"}
      onClick={handleClick}
      clickable={!!handleClick}
      subValue={!compact && goalTemp !== null ? <p className={`${statDetailClass} justify-center`}>mål {fmtC(goalTemp)}</p> : undefined}
    >
      {!compact && <div className="z-10 w-full flex flex-col min-h-0 gap-[3px]">
        {spanBar}
        {dutyBar}
      </div>}
    </StatCard>
  );
}
export const TempStat = memo(TempStatComponent);
