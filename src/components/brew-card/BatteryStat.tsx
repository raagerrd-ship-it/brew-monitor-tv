import { BrewData } from "@/types/brew";
import { DeviceMatch } from "./types";
import { isBrewInactive, calculateBatteryFillWidth } from "./utils";

interface BatteryStatProps {
  brew: BrewData;
  devices: DeviceMatch;
  updatedFields: Record<string, Record<string, boolean>>;
}

export function BatteryStat({ brew, devices, updatedFields }: BatteryStatProps) {
  const { pill } = devices;
  const batteryColor = pill?.color || 'hsl(var(--primary))';
  const isInactive = isBrewInactive(brew.status);

  return (
    <div 
      className={`rounded-xl p-1.5 pr-3 flex flex-col items-start justify-center gap-0 relative overflow-hidden backdrop-blur-sm ${isInactive ? 'opacity-40' : ''}`}
      style={{ 
        containerType: 'size',
        borderColor: `${batteryColor}33`,
        borderWidth: '1px',
        borderStyle: 'solid',
        background: `linear-gradient(135deg, ${batteryColor}05 0%, hsl(222 18% 15% / 0.5) 100%)`,
        boxShadow: updatedFields[brew.batch_id]?.battery 
          ? `0 0 25px ${batteryColor}66` 
          : '0 6px 20px hsl(222 30% 3% / 0.6), 0 3px 8px hsl(222 30% 3% / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.06)'
      }}
    >
      <div className="absolute top-1/2 -translate-y-1/2 opacity-10" style={{ width: '55%', height: '55%', right: '-12%' }}>
        <svg viewBox="0 0 24 24" fill="none" className="w-full h-full" style={{ transform: 'rotate(-90deg)' }}>
          <rect x="2" y="6" width="18" height="12" rx="2" stroke={batteryColor} strokeWidth="0.75" fill="none"/>
          <path d="M22 9v6" stroke={batteryColor} strokeWidth="0.75" strokeLinecap="round"/>
          {brew.battery !== null && (
            <rect 
              x="4" 
              y="8" 
              width={`${calculateBatteryFillWidth(brew.battery)}`} 
              height="8" 
              rx="1" 
              fill={batteryColor}
              className="transition-all duration-500"
              opacity="0.6"
            />
          )}
        </svg>
      </div>
      <p className="text-muted-foreground/60 tracking-wide z-10 pl-2 font-normal" style={{ fontSize: 'max(11px, min(1.8vh, 1vw))' }}>Batteri</p>
      <p 
        className={`font-bold leading-none z-10 pl-2 ${updatedFields[brew.batch_id]?.battery ? 'animate-value-shimmer' : ''} ${!isInactive && brew.battery !== null && brew.battery < 20 ? 'animate-battery-pulse' : ''}`}
        style={{ 
          fontSize: 'max(28px, min(5.5vh, 2.5vw))',
          color: !isInactive && brew.battery !== null && brew.battery < 20 ? 'hsl(0 70% 50%)' : batteryColor,
          textShadow: !isInactive && brew.battery !== null && brew.battery < 20 ? '0 0 15px hsl(0 70% 50% / 0.4)' : `0 0 15px ${batteryColor}30`
        }}
      >
        {isInactive ? "--" : (brew.battery !== null ? `${brew.battery}%` : "--")}
      </p>
    </div>
  );
}
