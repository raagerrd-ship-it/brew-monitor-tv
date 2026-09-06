import { useState, useEffect, memo } from 'react';
import { useTvMode } from "@/contexts/TvModeContext";

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
    <div className="flex flex-col items-end justify-center h-full">
      <p 
        className="font-semibold tabular-nums tracking-tight text-foreground"
        style={{ 
          fontSize: '24px',
          fontFamily: "'JetBrains Mono', monospace",
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
        }}
      >
        {time.slice(0, 5)}
        <span className="text-muted-foreground/40">:</span>
        <span className="text-muted-foreground/60">{time.slice(6, 8)}</span>
      </p>
      <p 
        className="text-muted-foreground/60 uppercase font-bold" 
        style={{ fontSize: '10px', lineHeight: 1.1, letterSpacing: '0.18em' }}
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
