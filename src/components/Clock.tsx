import { useState, useEffect, useRef, memo } from 'react';
import { useTvMode } from '@/contexts/TvModeContext';

function ClockComponent() {
  const { isTvMode } = useTvMode();
  const [displayTime, setDisplayTime] = useState(new Date());
  const internalTimeRef = useRef(Date.now());
  const lastSyncRef = useRef(Date.now());

  useEffect(() => {
    // In TV mode: update every 60 seconds to save resources (no seconds shown)
    // In normal mode: update every second for smooth ticking
    const tickInterval = isTvMode ? 60000 : 1000;
    
    const tick = () => {
      internalTimeRef.current += tickInterval;
      setDisplayTime(new Date(internalTimeRef.current));
    };
    
    const intervalId = setInterval(tick, tickInterval);

    // Sync with system time periodically
    const syncInterval = setInterval(() => {
      const now = Date.now();
      const drift = Math.abs(now - internalTimeRef.current);
      
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
      clearInterval(intervalId);
      clearInterval(syncInterval);
    };
  }, [isTvMode]);

  return (
    <div className="flex flex-col items-end justify-center">
      <p 
        className="font-semibold tabular-nums tracking-tight text-foreground"
        style={{ 
          fontSize: '24px',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.1,
        }}
      >
        {displayTime.toLocaleTimeString("sv-SE", {
          hour: "2-digit",
          minute: "2-digit",
        })}
        {/* Only show seconds in non-TV mode */}
        {!isTvMode && (
          <>
            <span className="text-muted-foreground/40">:</span>
            <span className="text-muted-foreground/60">
              {displayTime.getSeconds().toString().padStart(2, '0')}
            </span>
          </>
        )}
      </p>
      <p 
        className="text-muted-foreground/50 uppercase tracking-wider font-medium" 
        style={{ fontSize: '11px' }}
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
