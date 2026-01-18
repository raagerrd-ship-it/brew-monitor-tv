import { memo } from "react";
import { BrewData } from "@/types/brew";
import { DeviceMatch } from "./types";
import { isBrewInactive, calculateBatteryFillWidth } from "./utils";
import { StatCard } from "./StatCard";

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
  
  const isLowBattery = !isInactive && batteryValue !== null && batteryValue < 20;
  const displayColor = isLowBattery ? 'hsl(0 70% 50%)' : batteryColor;

  const batteryIcon = (
    <svg viewBox="0 0 24 24" fill="none" className="w-full h-full" style={{ transform: 'rotate(-90deg)' }}>
      <rect x="2" y="6" width="18" height="12" rx="2" stroke={batteryColor} strokeWidth="0.75" fill="none"/>
      <path d="M22 9v6" stroke={batteryColor} strokeWidth="0.75" strokeLinecap="round"/>
      {batteryValue !== null && (
        <rect 
          x="4" 
          y="8" 
          width={`${calculateBatteryFillWidth(batteryValue)}`} 
          height="8" 
          rx="1" 
          fill={batteryColor}
          className="transition-all duration-500"
          opacity="0.6"
        />
      )}
    </svg>
  );

  const displayValue = isInactive ? "--" : (batteryValue !== null ? `${Math.round(batteryValue)}%` : "--");

  return (
    <StatCard
      label="Batteri"
      value={displayValue}
      color={displayColor}
      isUpdated={updatedFields[brew.batch_id]?.battery}
      isInactive={isInactive}
      icon={batteryIcon}
      className={isLowBattery ? 'animate-battery-pulse' : ''}
    />
  );
}

export const BatteryStat = memo(BatteryStatComponent);
