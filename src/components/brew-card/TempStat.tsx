import { memo } from "react";
import { BrewData } from "@/types/brew";
import { DeviceMatch } from "./types";
import { isBrewInactive } from "./utils";
import { StatCard, MiniBar, statDetailClass } from "./StatCard";
import { RollingNumber } from "@/components/RollingNumber";
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

  // Kombinerad stapel: profilmål ±3°, segment botten (givare) → yta (pill), punkt för visat värde, tunn effektlinje under.
  const centerT = currentProfileTarget ?? targetTemp ?? null;
  const pctOf = (t: number) => centerT === null ? 50 : ((t - (centerT - 3)) / 6) * 100;
  const sensors = [probeTemp, pillTemp].filter((t): t is number => t !== null);
  const duty = brew.dutyPct ?? 0;
  const dutyColor = brew.dutyMode === 'heating' ? 'hsl(15 85% 55%)' : 'hsl(var(--temp-blue))';
  const tempBar = !isInactive && centerT !== null && sensors.length > 0 ? (
    <>
      <MiniBar
        from={pctOf(Math.min(...sensors))}
        to={Math.max(pctOf(Math.max(...sensors)), pctOf(Math.min(...sensors)) + 2)}
        color={isOvershoot ? 'hsl(38 92% 50% / 0.7)' : 'hsl(var(--ferment-green) / 0.6)'}
        marker={50}
        markerColor="hsl(38 92% 55%)"
        dot={displayTemp !== null ? pctOf(displayTemp) : undefined}
        under={{ pct: duty, color: dutyColor }}
      />
      {duty > 0 && <p className={`${statDetailClass} !justify-end`}>{brew.dutyMode === 'heating' ? 'värme' : 'kyla'} {duty} %</p>}
    </>
  ) : null;

  return (
    <StatCard
      label="Temp"
      value={displayTemp === null ? '—' : <RollingNumber value={displayTemp} decimals={1} suffix={<span className="text-muted-foreground/40">°</span>} />}
      
      className="gap-0.5 !py-1.5 !px-1.5 !justify-start"
      color={isOvershoot ? 'hsl(38 92% 50%)' : tempColor}
      isUpdated={updatedFields[brew.batch_id]?.temp}
      isInactive={isInactive}
      title={tooltipParts.length > 0 ? tooltipParts.join(' | ') : undefined}
      rowSpan={2}
      labelSize="18px"
      valueSize={compact ? "26px" : "46px"}
      onClick={handleClick}
      clickable={!!handleClick}
      subValue={!compact && goalTemp !== null ? <p className={`${statDetailClass} justify-center`}>mål {fmtC(goalTemp)}</p> : undefined}
    >
      {!compact && <div className="z-10 w-full flex flex-col min-h-0 gap-[3px] mt-auto">
        {tempBar}
      </div>}
    </StatCard>
  );
}
export const TempStat = memo(TempStatComponent);
