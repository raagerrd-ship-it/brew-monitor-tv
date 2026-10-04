import { useState, useEffect, memo } from 'react';
import { useTvMode } from "@/contexts/TvModeContext";
import { RollingNumber } from "./RollingNumber";

function ClockComponent() {
  const { isTvMode } = useTvMode();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
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

  return (
    <div className="flex flex-col items-end justify-center h-full min-w-[116px]">
      <p 
        className="font-medium tabular-nums text-foreground"
        style={{ 
          fontSize: '25px',
          fontFamily: "'JetBrains Mono', monospace",
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
        }}
      >
        <RollingNumber value={time.slice(0, 2)} direction={1} />
        <span className="text-muted-foreground/40">:</span>
        <RollingNumber value={time.slice(3, 5)} direction={1} />
        <span className="text-muted-foreground/60"><RollingNumber value={time.slice(6, 8)} direction={1} /></span>
      </p>
      <p 
        className="text-foreground uppercase font-bold" 
        style={{ fontSize: '14px', lineHeight: 1.1, letterSpacing: '0.14em' }}
      >
        {now.toLocaleDateString("sv-SE", {
          weekday: "short",
          day: "numeric",
          month: "short",
        }).replace(/\.$/, '')}
      </p>
    </div>
  );
}

export const Clock = memo(ClockComponent);
