import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

interface AutoCoolingCountdownProps {
  lastAdjustmentTime: string | null;
  checkIntervalMinutes: number;
  enabled: boolean;
  coolingActive: boolean;
  currentTemp: number | null;
  targetTemp: number | null;
}

export const AutoCoolingCountdown = ({ 
  lastAdjustmentTime, 
  checkIntervalMinutes,
  enabled,
  coolingActive,
  currentTemp,
  targetTemp
}: AutoCoolingCountdownProps) => {
  const [timeRemaining, setTimeRemaining] = useState<string>("");

  useEffect(() => {
    console.log('AutoCoolingCountdown props:', { currentTemp, targetTemp, enabled, coolingActive });
    
    if (!enabled) {
      setTimeRemaining("--");
      return;
    }

    if (!coolingActive) {
      setTimeRemaining("Kylaren är inte aktiv");
      return;
    }

    if (!lastAdjustmentTime) {
      setTimeRemaining("Väntar på data...");
      return;
    }

    const updateCountdown = () => {
      const lastCheck = new Date(lastAdjustmentTime);
      const nextCheck = new Date(lastCheck.getTime() + checkIntervalMinutes * 60 * 1000);
      const now = new Date();
      const diff = nextCheck.getTime() - now.getTime();

      if (diff <= 0) {
        // Time has passed, but edge function might not have updated yet
        // Show that we're past due but waiting for the actual check
        const overdueSec = Math.abs(Math.floor(diff / 1000));
        if (overdueSec < 5) {
          setTimeRemaining("Kontrollerar...");
        } else if (overdueSec < 60) {
          setTimeRemaining(`Väntar (${overdueSec}s)`);
        } else {
          const overdueMin = Math.floor(overdueSec / 60);
          setTimeRemaining(`Väntar (${overdueMin}m)`);
        }
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

  // Check if we have temperature data
  if (currentTemp === null || targetTemp === null) {
    return (
      <div className="flex items-center gap-1">
        <Clock className="w-3 h-3 text-muted-foreground" />
        <span className="font-mono text-sm text-muted-foreground">
          {timeRemaining} <span className="text-xs">(väntar på temperaturdata)</span>
        </span>
      </div>
    );
  }

  // Check if target temperature is reached (with 0.1°C tolerance)
  const TEMP_TOLERANCE = 0.1;
  if (currentTemp <= (targetTemp + TEMP_TOLERANCE)) {
    return <span className="text-green-600 text-sm font-medium">Måltemp uppnådd</span>;
  }

  const tempDiff = (currentTemp - (targetTemp + TEMP_TOLERANCE)).toFixed(1);
  
  return (
    <div className="flex items-center gap-1">
      <Clock className="w-3 h-3 text-primary" />
      <span className="font-mono text-sm font-medium text-primary">
        {timeRemaining} <span className="text-xs text-muted-foreground">(+{tempDiff}°C över mål)</span>
      </span>
    </div>
  );
};
