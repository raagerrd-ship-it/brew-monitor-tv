import { memo, useEffect, useRef, useState } from "react";
import { useTvMode } from "@/contexts/TvModeContext";

const DURATION_DESKTOP = 700;
const DURATION_TV = 2000;

interface RollingNumberProps {
  value: number | string;
  decimals?: number;
  mutedLastDigit?: boolean;
  suffix?: React.ReactNode;
  direction?: 1 | -1;
  maxDuration?: number;
  mode?: "strip" | "step";
}

// I vila ritas bara siffran; vid byte ritas en kort remsa med just de siffror som passeras
// (strip) eller [gammal, ny] (step), som glider med transform och sedan kollapsar.
const RollingDigit = memo(function RollingDigit({ digit, direction, duration, mode }: { digit: number; direction: number; duration: number; mode: "strip" | "step" }) {
  const [roll, setRoll] = useState<{ seq: number[]; from: number; to: number } | null>(null);
  const previous = useRef(digit);
  const element = useRef<HTMLSpanElement>(null);
  const directionRef = useRef(direction);
  directionRef.current = direction;

  useEffect(() => {
    if (digit === previous.current) return;
    const old = previous.current;
    previous.current = digit;
    if (element.current?.closest(".cleaning-transition-active") || (mode === "strip" && directionRef.current === 0)) {
      setRoll(null);
      return;
    }
    let next: { seq: number[]; from: number; to: number };
    if (mode === "step") {
      // Ett steg: uppåt vid ökning, nedåt vid minskning
      next = directionRef.current < 0 ? { seq: [digit, old], from: 1, to: 0 } : { seq: [old, digit], from: 0, to: 1 };
    } else if (directionRef.current > 0) {
      const steps = (digit - old + 10) % 10;
      next = { seq: Array.from({ length: steps + 1 }, (_, i) => (old + i) % 10), from: 0, to: steps };
    } else {
      const steps = (old - digit + 10) % 10;
      next = { seq: Array.from({ length: steps + 1 }, (_, i) => (digit + i) % 10), from: steps, to: 0 };
    }
    setRoll(next);
  }, [digit, mode]);

  useEffect(() => {
    if (!roll) return;
    const end = window.setTimeout(() => setRoll(null), duration + 300);
    return () => window.clearTimeout(end);
  }, [roll, duration]);

  return (
    <span ref={element} aria-hidden="true" className="inline-block h-[1em] overflow-hidden align-baseline leading-none tabular-nums" style={{ verticalAlign: '-0.14em' }}>
      {roll ? (
        <span key={`${roll.seq.join('')}-${roll.from}-${roll.to}`} className="rolling-number-strip block leading-none" onAnimationEnd={() => setRoll(null)} style={{ '--roll-from': `translateY(-${roll.from}em)`, '--roll-to': `translateY(-${roll.to}em)`, animationDuration: `${duration}ms` } as React.CSSProperties}>
          {roll.seq.map((n, i) => <span key={i} className="block h-[1em] leading-none">{n}</span>)}
        </span>
      ) : digit}
    </span>
  );
});

export const RollingNumber = memo(function RollingNumber({ value, decimals, mutedLastDigit = false, suffix, direction: forcedDirection, maxDuration, mode = "strip" }: RollingNumberProps) {
  const { isTvMode } = useTvMode();
  const duration = Math.min(isTvMode ? DURATION_TV : DURATION_DESKTOP, maxDuration ?? Infinity);
  const formatted = typeof value === "number" ? value.toFixed(decimals ?? 0) : value;
  const previous = useRef(Number(formatted));
  const numeric = Number(formatted);
  const direction = numeric === previous.current ? 0 : forcedDirection ?? (numeric > previous.current ? 1 : -1);
  useEffect(() => { previous.current = numeric; }, [numeric]);

  return (
    <span className="inline-flex items-baseline whitespace-nowrap tabular-nums leading-none" aria-label={`${formatted}${typeof suffix === "string" ? suffix : ""}`}>
      {Array.from(formatted).map((char, i) => (
        <span key={i} className={mutedLastDigit && i === formatted.length - 1 ? "text-muted-foreground/40" : undefined}>
          {/\d/.test(char) ? <RollingDigit digit={Number(char)} direction={direction} duration={duration} mode={mode} /> : char}
        </span>
      ))}
      {suffix}
    </span>
  );
});