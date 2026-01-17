import { useState, useEffect, useRef, memo } from 'react';

function ClockComponent() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const lastSecondRef = useRef(currentTime.getSeconds());

  useEffect(() => {
    let animationId: number;
    
    const tick = () => {
      const now = new Date();
      // Only update state when the second changes to avoid unnecessary re-renders
      if (now.getSeconds() !== lastSecondRef.current) {
        lastSecondRef.current = now.getSeconds();
        setCurrentTime(now);
      }
      animationId = requestAnimationFrame(tick);
    };
    
    animationId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationId);
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
        {currentTime.toLocaleTimeString("sv-SE", {
          hour: "2-digit",
          minute: "2-digit",
        })}
        <span className="text-muted-foreground/40">:</span>
        <span className="text-muted-foreground/60">
          {currentTime.getSeconds().toString().padStart(2, '0')}
        </span>
      </p>
      <p 
        className="text-muted-foreground/50 uppercase tracking-wider font-medium" 
        style={{ fontSize: 'min(2vh, 1.1vw)' }}
      >
        {currentTime.toLocaleDateString("sv-SE", {
          weekday: "short",
          day: "numeric",
          month: "short",
        })}
      </p>
    </div>
  );
}

export const Clock = memo(ClockComponent);
