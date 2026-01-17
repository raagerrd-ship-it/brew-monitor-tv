import { BrewData } from "@/types/brew";
import { DeviceMatch } from "./types";
import { isBrewInactive, calculateThermometerFill } from "./utils";
import { StatCard } from "./StatCard";

interface TempStatProps {
  brew: BrewData;
  devices: DeviceMatch;
  updatedFields: Record<string, Record<string, boolean>>;
  isAuthenticated: boolean;
  onDeviceLinkOpen: (brewId: string, brewName: string, controllerId: string | null, pillId: string | null) => void;
}

export function TempStat({ brew, devices, updatedFields, isAuthenticated, onDeviceLinkOpen }: TempStatProps) {
  const { pill, controller } = devices;
  const tempColor = pill?.color || 'hsl(var(--primary))';
  const isInactive = isBrewInactive(brew.status);

  // Use controller's built-in temp if available, otherwise fall back to pill/brew temp
  const displayTemp = controller?.current_temp ?? brew.currentTemp;

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
        className="transition-all duration-500"
        opacity="0.6"
      />
    </svg>
  );

  const label = controller && controller.target_temp !== null 
    ? `Temp (${controller.target_temp.toFixed(1)}°)` 
    : 'Temp';

  // Build tooltip text showing temp source
  const tooltipParts: string[] = [];
  if (isAuthenticated) {
    tooltipParts.push("Klicka för att koppla enheter");
  }
  if (controller?.current_temp !== null && controller?.current_temp !== undefined) {
    tooltipParts.push(`Inbyggd: ${controller.current_temp.toFixed(1)}°`);
  }
  if (pill) {
    tooltipParts.push(`Pill: ${brew.currentTemp.toFixed(1)}°`);
  }

  return (
    <StatCard
      label={label}
      value={`${displayTemp.toFixed(1)}°`}
      color={tempColor}
      isUpdated={updatedFields[brew.batch_id]?.temp}
      isInactive={isInactive}
      clickable={isAuthenticated}
      onClick={() => {
        if (isAuthenticated) {
          onDeviceLinkOpen(
            brew.batch_id,
            brew.name,
            brew.linked_controller_id || null,
            brew.linked_pill_id || null
          );
        }
      }}
      title={tooltipParts.length > 0 ? tooltipParts.join(' | ') : undefined}
      icon={thermometerIcon}
    />
  );
}
