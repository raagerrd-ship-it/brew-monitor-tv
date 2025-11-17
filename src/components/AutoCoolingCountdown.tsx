import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

interface AutoCoolingCountdownProps {
  lastAdjustmentTime: string | null;
  checkIntervalMinutes: number;
  enabled: boolean;
  coolingActive: boolean;
}

export const AutoCoolingCountdown = ({ 
  lastAdjustmentTime, 
  checkIntervalMinutes,
  enabled,
  coolingActive
}: AutoCoolingCountdownProps) => {
  const [timeRemaining, setTimeRemaining] = useState<string>("");

  useEffect(() => {
    if (!enabled) {
      setTimeRemaining("--");
      return;
    }

    if (!coolingActive) {
      setTimeRemaining("Kylaren är inte aktiv");
      return;
    }

    if (!lastAdjustmentTime) {
      setTimeRemaining("--");
      return;
    }

    const updateCountdown = () => {
      const lastCheck = new Date(lastAdjustmentTime);
      const nextCheck = new Date(lastCheck.getTime() + checkIntervalMinutes * 60 * 1000);
      const now = new Date();
      const diff = nextCheck.getTime() - now.getTime();

      if (diff <= 0) {
        setTimeRemaining("Kontrollerar nu...");
        return;
      }

      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);

      if (minutes > 0) {
        setTimeRemaining(`${minutes}m ${seconds}s`);
      } else {
        setTimeRemaining(`${seconds}s`);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [lastAdjustmentTime, checkIntervalMinutes, enabled, coolingActive]);

  if (!enabled) {
    return <span className="text-muted-foreground text-xs">Inaktiverad</span>;
  }

  if (!coolingActive) {
    return <span className="text-muted-foreground text-xs">Kylaren är inte aktiv</span>;
  }

  return (
    <div className="flex items-center gap-1">
      <Clock className="w-3 h-3 text-primary" />
      <span className="font-mono text-sm font-medium text-primary">
        {timeRemaining}
      </span>
    </div>
  );
};
