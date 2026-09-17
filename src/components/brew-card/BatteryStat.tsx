import { memo } from "react";
import { BrewData } from "@/types/brew";
import { DeviceMatch } from "./types";
import { isBrewInactive } from "./utils";
import { StatCard } from "./StatCard";
import { isBatteryStale, batteryAgeLabel } from "@/lib/battery-age";

interface BatteryStatProps {
  brew: BrewData;
  devices: DeviceMatch;
  updatedFields: Record<string, Record<string, boolean>>;
}

function BatteryStatComponent({ brew, devices, updatedFields }: BatteryStatProps) {
  const { pill } = devices;
  const batteryColor = pill?.color || 'hsl(var(--primary))';
  const isInactive = isBrewInactive(brew.status);
  
  // Use pill battery if brew battery is null and we have a linked pill
  const batteryValue = brew.battery !== null ? brew.battery : (pill?.battery_level ?? null);
  
  // Utan känd tidsstämpel vet vi inte åldern — märk inte värdet som gammalt.
  const isStale = pill?.last_update ? isBatteryStale(pill.last_update) : false;
  const isLowBattery = !isInactive && !isStale && batteryValue !== null && batteryValue < 20;
  const displayColor = isStale ? 'hsl(var(--muted-foreground))' : isLowBattery ? 'hsl(0 70% 50%)' : batteryColor;


  // Format battery with 1 decimal, fading the decimal part including dot
  const formatBatteryValue = () => {
    if (isInactive || batteryValue === null) return "--";
    const formatted = batteryValue.toFixed(1);
    const [whole, decimal] = formatted.split('.');
    return (
      <span className="tabular-nums">
        {whole}<span className="text-muted-foreground/40">.{decimal}%</span>
      </span>
    );
  };

  const displayValue = formatBatteryValue();

  return (
    <StatCard
      label="Batteri"
      value={displayValue}
      color={displayColor}
      isUpdated={updatedFields[brew.batch_id]?.battery}
      isInactive={isInactive}
      className={isLowBattery ? 'animate-battery-pulse' : ''}
      title={isStale && !isInactive ? `Gammal avläsning · ${batteryAgeLabel(pill?.last_update)}` : undefined}
      subValue={
        isStale && !isInactive && batteryValue !== null ? (
          <span className="text-[9px] text-muted-foreground/60">{batteryAgeLabel(pill?.last_update)}</span>
        ) : undefined
      }
    />
  );
}

export const BatteryStat = memo(BatteryStatComponent);
