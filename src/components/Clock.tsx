import { useState, useEffect, memo } from 'react';
import { useTvMode } from "@/contexts/TvModeContext";

function ClockComponent() {
  const { isTvMode } = useTvMode();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    // Update every second
    const interval = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const time = now.toLocaleTimeString("sv-SE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  // Split "HH:MM:SS" into parts
  const [hm, sec] = [time.slice(0, 5), time.slice(6, 8)];

  return (
    <div className="flex flex-col items-end justify-center">
      <p 
        className="font-semibold tabular-nums tracking-tight text-foreground"
        style={{ 
          fontSize: '24px',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
        }}
      >
        {hm}
        <span className="text-muted-foreground/40">:</span>
        <span className="text-muted-foreground/60">{sec}</span>
      </p>
      <p 
        className="text-muted-foreground/50 uppercase tracking-wider font-medium" 
        style={{ fontSize: '11px' }}
      >
        {now.toLocaleDateString("sv-SE", {
          weekday: "short",
          day: "numeric",
          month: "short",
        })}
      </p>
    </div>
  );
}

export const Clock = memo(ClockComponent);
