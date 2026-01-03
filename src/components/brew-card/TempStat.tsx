import { BrewData, PillData, TempController } from "@/types/brew";
import { DeviceMatch } from "./types";
import { isBrewInactive, calculateThermometerFill } from "./utils";

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

  return (
    <div 
      className={`rounded-xl p-1.5 pr-3 flex flex-col items-start justify-center gap-0 relative overflow-hidden backdrop-blur-sm ${isAuthenticated ? 'cursor-pointer hover:opacity-80' : ''} ${isInactive ? 'opacity-40' : ''}`}
      style={{ 
        containerType: 'size',
        borderColor: `${tempColor}33`,
        borderWidth: '1px',
        borderStyle: 'solid',
        background: `linear-gradient(135deg, ${tempColor}08 0%, hsl(222 18% 15% / 0.5) 100%)`,
        boxShadow: updatedFields[brew.batch_id]?.temp 
          ? `0 0 25px ${tempColor}66`
          : '0 6px 20px hsl(222 30% 3% / 0.6), 0 3px 8px hsl(222 30% 3% / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.06)',
        ...(updatedFields[brew.batch_id]?.temp && {
          borderColor: `${tempColor}66`
        })
      }}
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
    >
      <div className="absolute top-1/2 -translate-y-1/2 opacity-10" style={{ width: '60%', height: '60%', right: '-15%' }}>
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
      </div>
      <p className="text-muted-foreground/60 tracking-wide z-10 pl-2 font-normal" style={{ fontSize: 'max(11px, min(1.8vh, 1vw))' }}>
        Temp{controller && controller.target_temp !== null && ` (${controller.target_temp.toFixed(0)}°)`}
      </p>
      <p 
        className={`font-bold leading-none z-10 pl-2 ${updatedFields[brew.batch_id]?.temp ? 'animate-value-shimmer' : ''}`}
        style={{ 
          color: tempColor,
          fontSize: 'max(28px, min(5.5vh, 2.5vw))',
          textShadow: `0 0 15px ${tempColor}40`
        }}
      >
        {brew.currentTemp}°
      </p>
    </div>
  );
}
