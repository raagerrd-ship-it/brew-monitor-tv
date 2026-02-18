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

  // Use controller's built-in temp if available, otherwise fall back to pill/brew temp
  const displayTemp = controller?.current_temp ?? brew.currentTemp;

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

  // Show both targets if original differs from current (auto-adjusted)
  const showBothTargets = originalTarget !== null && targetTemp !== null && targetTemp !== undefined
    && Math.abs(originalTarget - targetTemp) >= 0.1;
  
  let label: React.ReactNode = 'Temp';
  if (controller && controller.target_temp !== null) {
    if (showBothTargets) {
      label = (
        <span>
          Temp{' '}
          <span style={{ color: 'hsl(38 92% 50%)' }}>{controller.target_temp.toFixed(1)}</span>
          /
          <span style={{ color: 'hsl(var(--muted-foreground))' }}>{originalTarget!.toFixed(1)}</span>
        </span>
      );
    } else {
      label = `Temp (${controller.target_temp.toFixed(1)}°)`;
    }
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
    const tTemp = targetTemp;
    
    // Range: show from min-1 to max+1 for padding
    const allTemps = [pTemp, cTemp, tTemp];
    const rangeMin = Math.min(...allTemps) - 0.5;
    const rangeMax = Math.max(...allTemps) + 0.5;
    const range = rangeMax - rangeMin || 1;
    
    const pct = (t: number) => Math.max(0, Math.min(100, ((t - rangeMin) / range) * 100));
    
    const pillPct = pct(pTemp);
    const ctrlPct = pct(cTemp);
    const targetPct = pct(tTemp);
    const leftPct = Math.min(pillPct, ctrlPct);
    const rightPct = Math.max(pillPct, ctrlPct);
    
    const spanColor = isOvershoot 
      ? 'hsl(38 92% 50%)' 
      : 'hsl(var(--temp-blue))';

    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="w-full px-1 cursor-help" style={{ height: '10px' }}>
              {/* Track */}
              <div className="relative w-full h-[4px] rounded-full" style={{ background: 'hsl(var(--muted) / 0.3)', marginTop: '3px' }}>
                {/* Span fill between pill and controller */}
                <div 
                  className="absolute h-full rounded-full"
                  style={{ 
                    left: `${leftPct}%`, 
                    width: `${rightPct - leftPct}%`,
                    background: spanColor,
                    opacity: 0.4,
                  }} 
                />
                {/* Target marker line */}
                <div 
                  className="absolute top-[-2px] h-[8px] rounded-sm"
                  style={{ 
                    left: `${targetPct}%`, 
                    width: '2px',
                    background: 'hsl(38 92% 50%)',
                    transform: 'translateX(-1px)',
                  }} 
                />
                {/* Controller dot (core) */}
                <div 
                  className="absolute top-1/2 -translate-y-1/2 rounded-full"
                  style={{ 
                    left: `${ctrlPct}%`, 
                    width: '5px', height: '5px',
                    background: 'hsl(var(--temp-blue))',
                    transform: 'translate(-50%, -50%)',
                    boxShadow: '0 0 4px hsl(var(--temp-blue) / 0.5)',
                  }} 
                />
                {/* Pill dot (surface) */}
                <div 
                  className="absolute top-1/2 -translate-y-1/2 rounded-full"
                  style={{ 
                    left: `${pillPct}%`, 
                    width: '5px', height: '5px',
                    background: 'hsl(var(--ferment-green))',
                    transform: 'translate(-50%, -50%)',
                    boxShadow: '0 0 4px hsl(var(--ferment-green) / 0.5)',
                  }} 
                />
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <div className="space-y-0.5">
              <p><span style={{ color: 'hsl(var(--temp-blue))' }}>●</span> Controller: {cTemp.toFixed(1)}°</p>
              <p><span style={{ color: 'hsl(var(--ferment-green))' }}>●</span> Pill: {pTemp.toFixed(1)}°</p>
              <p><span style={{ color: 'hsl(38 92% 50%)' }}>│</span> Mål: {tTemp.toFixed(1)}°</p>
              <p className="text-muted-foreground">Δ {delta! >= 0 ? '+' : ''}{delta!.toFixed(1)}°</p>
              {isOvershoot && <p style={{ color: 'hsl(38 92% 50%)' }}>⚠ Overshoot</p>}
              {overshootReason && <p className="text-foreground border-t border-border pt-0.5 mt-0.5"><span className="font-medium">AI:</span> {overshootReason}</p>}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  })() : null;

  const subValueContent = spanBar;

  return (
    <StatCard
      label={label}
      value={`${displayTemp.toFixed(1)}°`}
      color={isOvershoot ? 'hsl(38 92% 50%)' : tempColor}
      isUpdated={updatedFields[brew.batch_id]?.temp}
      isInactive={isInactive}
      title={tooltipParts.length > 0 ? tooltipParts.join(' | ') : undefined}
      icon={thermometerIcon}
      onClick={handleClick}
      clickable={!!handleClick}
      subValue={subValueContent}
    />
  );
}
export const TempStat = memo(TempStatComponent);
