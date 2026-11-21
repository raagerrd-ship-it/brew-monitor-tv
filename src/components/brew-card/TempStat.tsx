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



  // SSOT: centralized target temp calculation
  // Read profile_target_temp from controller directly (SSOT for both manual and profile modes)
  const currentProfileTarget = controller?.profile_target_temp
    ?? brew.fermentationSession?.controller_profile_target_temp
    ?? null;
  const { actualTarget: displayTarget, pidCompensation: compensation } = getDisplayTarget(
    currentProfileTarget,
    targetTemp
  );
  const showBothTargets = compensation !== null && Math.abs(compensation) >= 0.1;
  
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

  // Skiktning: visas bara när botten (givare) och yta (pill) skiljer ≥ 1,0°.
  const stratText = !isInactive && probeTemp !== null && pillTemp !== null && Math.abs(pillTemp - probeTemp) >= 1
    ? <><span className="whitespace-nowrap">botten {fmtC(probeTemp)} ·</span> <span className="whitespace-nowrap">yta {fmtC(pillTemp)}</span></>
    : null;

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
              <span className="text-[12px] text-muted-foreground/80 tabular-nums tracking-tight leading-none whitespace-nowrap">{duty === 0 ? 'Av' : `${mode === 'cooling' ? 'Kyla' : mode === 'heating' ? 'Värme' : 'Effekt'} ${duty} %`}</span>
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
        {dutyBar}
        {stratText && <p className="text-[12px] leading-tight tabular-nums tracking-tight text-center text-muted-foreground/80">{stratText}</p>}
      </div>}
    </StatCard>
  );
}
export const TempStat = memo(TempStatComponent);
