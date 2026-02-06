import { useState, useEffect, useRef, memo, useMemo } from 'react';

import { useTvMode } from "@/contexts/TvModeContext";
// Generate array of seconds 00-59 for CSS animation
const SECONDS_ARRAY = Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, '0'));

function ClockComponent() {
  const { isTvMode } = useTvMode();
  const [displayTime, setDisplayTime] = useState(new Date());
  const [initialSecond, setInitialSecond] = useState(() => new Date().getSeconds());
  const internalTimeRef = useRef(Date.now());

  useEffect(() => {
    // Sync with system time every 30 seconds
    const syncInterval = setInterval(() => {
      const now = Date.now();
      internalTimeRef.current = now;
      const newDate = new Date(now);
      setDisplayTime(newDate);
      setInitialSecond(newDate.getSeconds());
    }, 30000);

    // Initial sync
    const now = Date.now();
    internalTimeRef.current = now;
    const initialDate = new Date(now);
    setDisplayTime(initialDate);
    setInitialSecond(initialDate.getSeconds());

    return () => {
      clearInterval(syncInterval);
    };
  }, []);

  // Calculate animation delay to start from current second
  // Negative delay = start partway through the animation
  const animationDelay = useMemo(() => {
    return `-${initialSecond}s`;
  }, [initialSecond]);

  return (
    <div className="flex flex-col items-end justify-center">
      <p 
        className="font-semibold tabular-nums tracking-tight text-foreground"
        style={{ 
          fontSize: '18px',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
        }}
      >
        {displayTime.toLocaleTimeString("sv-SE", {
          hour: "2-digit",
          minute: "2-digit",
        })}
        <span className="text-muted-foreground/40">:</span>
        {/* CSS-animated seconds - no React re-renders */}
        <span 
          className="text-muted-foreground/60 inline-block overflow-hidden"
          style={{ 
            height: '18px',
            width: '2ch',
            verticalAlign: 'bottom',
          }}
        >
          <span 
            className="flex flex-col"
            style={{
              animation: 'clock-seconds 60s steps(60) infinite',
              animationDelay,
            }}
          >
            {SECONDS_ARRAY.map((sec) => (
              <span key={sec} className="block" style={{ height: '18px', lineHeight: '18px' }}>{sec}</span>
            ))}
          </span>
        </span>
      </p>
      <p 
        className="text-muted-foreground/50 uppercase tracking-wider font-medium" 
        style={{ fontSize: '9px' }}
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
