import { useState, useEffect, useRef, memo } from 'react';

function ClockComponent() {
  const [displayTime, setDisplayTime] = useState(new Date());
  const internalTimeRef = useRef(Date.now());
  const lastSyncRef = useRef(Date.now());

  useEffect(() => {
    // Increment internal time every second independently
    // This makes the clock "smooth" even during page updates
    const tickInterval = setInterval(() => {
      internalTimeRef.current += 1000;
      setDisplayTime(new Date(internalTimeRef.current));
    }, 1000);

    // Sync with system time periodically (every 30 seconds)
    // This corrects any drift without interrupting the smooth ticking
    const syncInterval = setInterval(() => {
      const now = Date.now();
      const drift = Math.abs(now - internalTimeRef.current);
      
      // Only sync if drift is more than 500ms to avoid visible jumps
      if (drift > 500) {
        internalTimeRef.current = now;
        lastSyncRef.current = now;
        setDisplayTime(new Date(now));
      }
    }, 30000);

    // Initial sync
    internalTimeRef.current = Date.now();
    setDisplayTime(new Date(internalTimeRef.current));

    return () => {
      clearInterval(tickInterval);
      clearInterval(syncInterval);
    };
  }, []);

  return (
    <div className="flex flex-col items-end justify-center">
      <p 
        className="font-semibold tabular-nums tracking-tight text-foreground"
        style={{ 
          fontSize: 'min(4.5vh, 2.2vw)',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.1,
        }}
      >
        {displayTime.toLocaleTimeString("sv-SE", {
          hour: "2-digit",
          minute: "2-digit",
        })}
        <span className="text-muted-foreground/40">:</span>
        <span className="text-muted-foreground/60">
          {displayTime.getSeconds().toString().padStart(2, '0')}
        </span>
      </p>
      <p 
        className="text-muted-foreground/50 uppercase tracking-wider font-medium" 
        style={{ fontSize: 'min(2vh, 1.1vw)' }}
      >
        {displayTime.toLocaleDateString("sv-SE", {
          weekday: "short",
          day: "numeric",
          month: "short",
        })}
      </p>
    </div>
  );
}

export const Clock = memo(ClockComponent);
