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
          Temp (
          <span style={{ color: 'hsl(38 92% 50%)' }}>{controller.target_temp.toFixed(1)}</span>
          /
          <span style={{ color: 'hsl(var(--muted-foreground))' }}>{originalTarget!.toFixed(1)}</span>
          )
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

  // Delta indicator sub-element
  const deltaIndicator = delta !== null && !isInactive ? (
    <span 
      className="text-[9px] font-medium leading-none flex items-center gap-0.5"
      style={{ 
        color: delta > 0 
          ? 'hsl(var(--ferment-green))' 
          : delta < 0 
            ? 'hsl(210 80% 60%)' 
            : 'hsl(var(--muted-foreground))'
      }}
    >
      {delta > 0 ? '▲' : delta < 0 ? '▼' : '─'}
      {delta >= 0 ? '+' : ''}{delta.toFixed(1)}°
    </span>
  ) : null;

  // Overshoot warning indicator
  const overshootIndicator = isOvershoot ? (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span 
            className="text-[9px] font-semibold leading-none flex items-center gap-0.5 cursor-help animate-pulse"
            style={{ color: 'hsl(38 92% 50%)' }}
          >
            ⚠ Overshoot
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[250px] text-xs">
          <p className="font-semibold mb-1" style={{ color: 'hsl(38 92% 50%)' }}>
            🌡️ Uppvärmnings-overshoot
          </p>
          <p className="text-muted-foreground mb-1">
            Pill ({pillTemp.toFixed(1)}°) är över target ({targetTemp?.toFixed(1)}°) medan kärnan ({ctrlTemp?.toFixed(1)}°) fortfarande ligger under.
          </p>
          {overshootReason && (
            <p className="text-foreground border-t border-border pt-1 mt-1">
              <span className="font-medium">AI:</span> {overshootReason}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : overshootReason ? (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span 
            className="text-[9px] font-medium leading-none flex items-center gap-0.5 cursor-help"
            style={{ color: 'hsl(38 92% 50% / 0.7)' }}
          >
            🌡️
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[250px] text-xs">
          <p className="font-semibold mb-1">Senaste AI-justering</p>
          <p className="text-foreground">{overshootReason}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : null;

  // Combined sub-value with delta and overshoot on the same row
  const subValueContent = (deltaIndicator || overshootIndicator) ? (
    <div className="flex items-center justify-center gap-1.5">
      {deltaIndicator}
      {overshootIndicator}
    </div>
  ) : null;

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
