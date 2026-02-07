import { memo } from "react";
import { Play, Pause, ArrowDown, ArrowUp, Timer } from "lucide-react";

interface SessionStatusIconProps {
  status: string;
  waitingForTemp: boolean;
  isRamping: boolean;
  isRampingUp: boolean;
  isTvMode: boolean;
}

export const SessionStatusIcon = memo(function SessionStatusIcon({
  status,
  waitingForTemp,
  isRamping,
  isRampingUp,
  isTvMode,
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

  // Active/running state
  return (
    <div className="relative flex items-center justify-center w-7 h-7">
      {/* Solid indicator */}
      <div 
        className="relative w-3 h-3 rounded-full"
        style={{ 
          background: 'linear-gradient(135deg, hsl(142 70% 55%) 0%, hsl(142 70% 40%) 100%)',
          boxShadow: '0 0 8px hsl(142 70% 50% / 0.6)'
        }}
      />
    </div>
  );
});
