import { useState, useEffect, memo } from 'react';
import { useTvMode } from "@/contexts/TvModeContext";

function ClockComponent() {
  const { isTvMode } = useTvMode();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    // In TV mode, update every 60s (no seconds shown). Otherwise every second.
    const intervalMs = isTvMode ? 60000 : 1000;
    const interval = setInterval(() => {
      setNow(new Date());
    }, intervalMs);
    return () => clearInterval(interval);
  }, [isTvMode]);

  const time = now.toLocaleTimeString("sv-SE", {
    hour: "2-digit",
    minute: "2-digit",
    ...(isTvMode ? {} : { second: "2-digit" }),
  });

  return (
    <div className="flex flex-col items-end justify-center h-full">
      <p 
        className="font-semibold tabular-nums tracking-tight text-foreground"
        style={{ 
          fontSize: '25px',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
        }}
      >
        {isTvMode ? time : (
          <>
            {time.slice(0, 5)}
            <span className="text-muted-foreground/40">:</span>
            <span className="text-muted-foreground/60">{time.slice(6, 8)}</span>
          </>
        )}
      </p>
      <p 
        className="text-muted-foreground/50 uppercase tracking-wider font-medium" 
        style={{ fontSize: '15px', lineHeight: 1.1 }}
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
