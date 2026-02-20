import { memo, useEffect, useState } from "react";
import { BrewData } from "@/types/brew";
import { DeviceMatch } from "./types";
import { isBrewInactive, calculateThermometerFill } from "./utils";
import { StatCard } from "./StatCard";
import { supabase } from "@/integrations/supabase/client";
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

  // Fetch latest overshoot AI recommendation and original target for this controller
  const [overshootReason, setOvershootReason] = useState<string | null>(null);
  const [originalTarget, setOriginalTarget] = useState<number | null>(null);
  useEffect(() => {
    if (!controller?.controller_id) return;
    
    const fetchLatestOvershoot = async () => {
      const { data } = await supabase
        .from('auto_cooling_adjustments')
        .select('reason, created_at, original_target_temp')
        .or(`followed_controller_id.eq.${controller.controller_id},cooler_controller_id.eq.${controller.controller_id}`)
        .like('reason', '🌡️%')
        .order('created_at', { ascending: false })
        .limit(1);
      
      if (data && data.length > 0) {
        // Show original target if it differs from current target
        if (data[0].original_target_temp !== null && data[0].original_target_temp !== undefined) {
          setOriginalTarget(data[0].original_target_temp);
        }
        // Only show reason if recent (within 6 hours)
        const age = Date.now() - new Date(data[0].created_at).getTime();
        if (age < 6 * 60 * 60 * 1000) {
          setOvershootReason(data[0].reason.replace('🌡️ ', ''));
        } else {
          setOvershootReason(null);
        }
      }
    };
    
    fetchLatestOvershoot();
  }, [controller?.controller_id, brew.lastUpdateRaw]);

  const thermometerIcon = (
    <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
      <path 
        d="M14 4v10a4 4 0 1 1-4 0V4a2 2 0 1 1 4 0Z" 
        stroke={tempColor}
        strokeWidth="0.75" 
        fill="none"
      />
      <defs>
        <clipPath id={`thermo-clip-${brew.batch_id}`}>
          <path d="M14 4v10a4 4 0 1 1-4 0V4a2 2 0 1 1 4 0Z" />
        </clipPath>
      </defs>
      <rect 
        x="8" 
        y={`${calculateThermometerFill(displayTemp)}`}
        width="8" 
        height="20" 
        fill={tempColor}
        clipPath={`url(#thermo-clip-${brew.batch_id})`}
        className="transition-none"
        opacity="0.6"
      />
    </svg>
  );

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
  
  let label: React.ReactNode = hasBothSensors ? '' : 'Temp';
  let sensorSubValue: React.ReactNode = null;
  if (hasBothSensors) {
    const goalTemp = targetTemp?.toFixed(1);
    sensorSubValue = (
      <span style={{ fontSize: '10px', letterSpacing: '0.01em', marginTop: '-2px', display: 'block', whiteSpace: 'nowrap' }}>
        <span style={{ color: 'hsl(var(--temp-blue))' }}>C:{controller.current_temp!.toFixed(1)}</span>
        {goalTemp && <>{' '}<span style={{ color: 'hsl(38 92% 50%)' }}>M:{goalTemp}</span></>}
        {' '}
        <span style={{ color: 'hsl(var(--ferment-green))' }}>P:{brew.currentTemp.toFixed(1)}</span>
      </span>
    );
  } else if (controller && controller.target_temp !== null) {
    label = `Temp (${controller.target_temp.toFixed(1)}°)`;
  }

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
    
    // Fixed range: profile target ±3°C
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
            <div className="w-full cursor-help" style={{ height: '14px', display: 'flex', alignItems: 'center' }}>
              {/* Track background – full ±3° range */}
              <div className="relative w-full h-[8px] rounded-full" style={{ background: 'hsl(var(--muted) / 0.6)' }}>
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
                      top: '-3px',
                      width: '2px',
                      height: '12px',
                      backgroundImage: 'repeating-linear-gradient(to bottom, hsl(38 92% 50%), hsl(38 92% 50%) 2px, transparent 2px, transparent 4px)',
                      transform: 'translateX(-1px)',
                    }} 
                  />
                )}
                {/* Controller dot (blue) */}
                <div 
                  className="absolute top-1/2 rounded-full"
                  style={{ 
                    left: `${ctrlPct}%`, 
                    width: '6px', height: '6px',
                    background: 'hsl(var(--temp-blue))',
                    transform: 'translate(-50%, -50%)',
                    boxShadow: '0 0 6px hsl(var(--temp-blue) / 0.7)',
                  }} 
                />
                {/* Pill dot (green) */}
                <div 
                  className="absolute top-1/2 rounded-full"
                  style={{ 
                    left: `${pillPct}%`, 
                    width: '6px', height: '6px',
                    background: 'hsl(var(--ferment-green))',
                    transform: 'translate(-50%, -50%)',
                    boxShadow: '0 0 6px hsl(var(--ferment-green) / 0.7)',
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

  return (
    <StatCard
      label={<span style={{ marginTop: '-3px', display: 'block' }}>{label}</span>}
      value={<span style={{ marginTop: '-12px', marginBottom: '-2px', display: 'block' }}>{`${displayTemp.toFixed(1)}°`}</span>}
      subValue={sensorSubValue}
      color={isOvershoot ? 'hsl(38 92% 50%)' : tempColor}
      isUpdated={updatedFields[brew.batch_id]?.temp}
      isInactive={isInactive}
      title={tooltipParts.length > 0 ? tooltipParts.join(' | ') : undefined}
      icon={thermometerIcon}
      onClick={handleClick}
      clickable={!!handleClick}
    >
      {spanBar && (
        <div className="absolute bottom-0 left-1.5 right-1.5 z-10" style={{ paddingBottom: '3px' }}>
          {spanBar}
        </div>
      )}
    </StatCard>
  );
}
export const TempStat = memo(TempStatComponent);
