import { memo } from "react";
import { BrewData } from "@/types/brew";
import { DeviceMatch } from "./types";
import { isBrewInactive, calculateBatteryFillWidth } from "./utils";
import { StatCard } from "./StatCard";
import { Thermometer, Pill } from "lucide-react";

interface BatteryStatProps {
  brew: BrewData;
  devices: DeviceMatch;
  updatedFields: Record<string, Record<string, boolean>>;
}

function BatteryStatComponent({ brew, devices, updatedFields }: BatteryStatProps) {
  const { pill, controller } = devices;
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
          className={isBrewInactive(brew.status) ? '' : 'transition-all duration-500'}
          opacity="0.6"
        />
      )}
    </svg>
  );

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
      icon={batteryIcon}
      className={isLowBattery ? 'animate-battery-pulse' : ''}
    >
      {/* Device info badges */}
      {(controller || pill) && (
        <div className="flex items-center gap-1.5 z-10 mt-0.5">
          {controller && (
            <span 
              className="flex items-center gap-0.5 text-muted-foreground/50"
              style={{ fontSize: '8px' }}
              title={controller.name}
            >
              <Thermometer className="h-2.5 w-2.5" style={{ color: pill?.color || 'hsl(var(--primary))' }} />
              <span className="truncate max-w-[45px]">{controller.name}</span>
            </span>
          )}
          {pill && (
            <span 
              className="flex items-center gap-0.5 text-muted-foreground/50"
              style={{ fontSize: '8px' }}
              title={pill.name}
            >
              <Pill className="h-2.5 w-2.5" style={{ color: pill.color }} />
              <span className="truncate max-w-[45px]">{pill.name}</span>
            </span>
          )}
        </div>
      )}
    </StatCard>
  );
}

export const BatteryStat = memo(BatteryStatComponent);
