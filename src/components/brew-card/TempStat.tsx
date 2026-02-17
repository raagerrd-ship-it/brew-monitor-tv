import { memo } from "react";
import { BrewData } from "@/types/brew";
import { DeviceMatch } from "./types";
import { isBrewInactive, calculateThermometerFill } from "./utils";
import { StatCard } from "./StatCard";

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

  const label = controller && controller.target_temp !== null 
    ? `Temp (${controller.target_temp.toFixed(1)}°)` 
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

  return (
    <StatCard
      label={label}
      value={`${displayTemp.toFixed(1)}°`}
      color={tempColor}
      isUpdated={updatedFields[brew.batch_id]?.temp}
      isInactive={isInactive}
      title={tooltipParts.length > 0 ? tooltipParts.join(' | ') : undefined}
      icon={thermometerIcon}
      onClick={handleClick}
      clickable={!!handleClick}
      subValue={deltaIndicator}
    />
  );
}

export const TempStat = memo(TempStatComponent);
