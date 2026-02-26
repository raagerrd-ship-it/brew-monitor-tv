import { memo } from "react";
import { Play, Pause, ArrowDown, ArrowUp, Timer, Thermometer, Activity, Hand, Clock } from "lucide-react";

interface SessionStatusIconProps {
  status: string;
  waitingForTemp: boolean;
  isRamping: boolean;
  isRampingUp: boolean;
  isTvMode: boolean;
  stepType?: string;
}

export const SessionStatusIcon = memo(function SessionStatusIcon({
  status,
  waitingForTemp,
  isRamping,
  isRampingUp,
  isTvMode,
  stepType,
}: SessionStatusIconProps) {
  if (status === 'paused') {
    return (
      <div className="p-1.5 rounded-full bg-muted/50">
        <Pause className="h-4 w-4 text-muted-foreground" />
      </div>
    );
  }

  if (waitingForTemp) {
    return (
      <div 
        className="p-1.5 rounded-full"
        style={{ 
          background: 'linear-gradient(135deg, hsl(200 90% 50% / 0.3) 0%, hsl(200 90% 50% / 0.15) 100%)',
          boxShadow: '0 0 12px hsl(200 90% 50% / 0.4)'
        }}
      >
        <Timer className="h-4 w-4" style={{ color: 'hsl(200 90% 60%)' }} />
      </div>
    );
  }

  if (isRamping) {
    const RampIcon = isRampingUp ? ArrowUp : ArrowDown;
    return (
      <div 
        className="p-1.5 rounded-full"
        style={{ 
          background: 'linear-gradient(135deg, hsl(38 92% 50% / 0.3) 0%, hsl(38 92% 50% / 0.15) 100%)',
          boxShadow: '0 0 12px hsl(38 92% 50% / 0.4)'
        }}
      >
        <RampIcon className="h-4 w-4" style={{ color: 'hsl(38 92% 60%)' }} />
      </div>
    );
  }

  // Active/running state — show icon based on step type
  const { Icon, color } = getStepIconConfig(stepType);
  
  return (
    <div 
      className="p-1.5 rounded-full animate-[glow-pulse_2s_ease-in-out_infinite]"
      style={{ 
        background: `linear-gradient(135deg, ${color.bg} 0%, ${color.bgDark} 100%)`,
        boxShadow: `0 0 12px ${color.glow}`,
        '--glow-color': color.glow,
      } as React.CSSProperties}
    >
      <Icon className="h-4 w-4" style={{ color: color.icon }} />
    </div>
  );
});

function getStepIconConfig(stepType?: string) {
  switch (stepType) {
    case 'hold':
      return {
        Icon: Thermometer,
        color: {
          bg: 'hsl(142 70% 50% / 0.3)',
          bgDark: 'hsl(142 70% 50% / 0.15)',
          glow: 'hsl(142 70% 50% / 0.4)',
          icon: 'hsl(142 70% 60%)',
        },
      };
    case 'wait_for_gravity_stable':
    case 'wait_for_sg':
      return {
        Icon: Activity,
        color: {
          bg: 'hsl(280 70% 50% / 0.3)',
          bgDark: 'hsl(280 70% 50% / 0.15)',
          glow: 'hsl(280 70% 50% / 0.4)',
          icon: 'hsl(280 70% 70%)',
        },
      };
    case 'wait_for_temp':
      return {
        Icon: Thermometer,
        color: {
          bg: 'hsl(200 90% 50% / 0.3)',
          bgDark: 'hsl(200 90% 50% / 0.15)',
          glow: 'hsl(200 90% 50% / 0.4)',
          icon: 'hsl(200 90% 60%)',
        },
      };
    case 'wait_for_acknowledgement':
      return {
        Icon: Hand,
        color: {
          bg: 'hsl(38 92% 50% / 0.3)',
          bgDark: 'hsl(38 92% 50% / 0.15)',
          glow: 'hsl(38 92% 50% / 0.4)',
          icon: 'hsl(38 92% 60%)',
        },
      };
    case 'diacetyl_rest':
    case 'gradual_ramp':
      return {
        Icon: Activity,
        color: {
          bg: 'hsl(38 92% 50% / 0.3)',
          bgDark: 'hsl(38 92% 50% / 0.15)',
          glow: 'hsl(38 92% 50% / 0.4)',
          icon: 'hsl(38 92% 60%)',
        },
      };
    default:
      return {
        Icon: Thermometer,
        color: {
          bg: 'hsl(142 70% 50% / 0.3)',
          bgDark: 'hsl(142 70% 50% / 0.15)',
          glow: 'hsl(142 70% 50% / 0.4)',
          icon: 'hsl(142 70% 60%)',
        },
      };
  }
}
