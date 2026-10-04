import { useState, useEffect, useMemo, memo } from 'react';
import { RollingNumber } from "./RollingNumber";

const TIME_FORMAT = new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const DATE_FORMAT = new Intl.DateTimeFormat("sv-SE", { weekday: "short", day: "numeric", month: "short" });

function ClockComponent() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const time = TIME_FORMAT.format(now);
  const day = now.toDateString();
  const date = useMemo(() => DATE_FORMAT.format(now).replace(/\.$/, ''), [day]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <RollingNumber value={time.slice(0, 2)} mode="step" />
        <span className="text-muted-foreground/40">:</span>
        <RollingNumber value={time.slice(3, 5)} mode="step" />
        <span className="text-muted-foreground/25">:</span>
        <span className="text-muted-foreground/60"><RollingNumber value={time.slice(6, 7)} mode="step" maxDuration={2000} />{time.slice(7, 8)}</span>
      </p>
      <p 
        className="text-foreground uppercase font-bold" 
        style={{ fontSize: '14px', lineHeight: 1.1, letterSpacing: '0.14em' }}
      >
        {date}
      </p>
    </div>
  );
}

export const Clock = memo(ClockComponent);
