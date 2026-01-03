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
        y={`${calculateThermometerFill(brew.currentTemp)}`}
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
    ? `Temp (${controller.target_temp.toFixed(0)}°)` 
    : 'Temp';

  return (
    <StatCard
      label={label}
      value={`${brew.currentTemp}°`}
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
      title={isAuthenticated ? "Klicka för att koppla enheter" : undefined}
      icon={thermometerIcon}
    />
  );
}
