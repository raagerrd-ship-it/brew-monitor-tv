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
const RollingDigit = memo(function RollingDigit({ digit, direction, duration, mode, signChanged, newLeadingDigit }: { digit: number; direction: number; duration: number; mode: "strip" | "step"; signChanged: boolean; newLeadingDigit: boolean }) {
  const [roll, setRoll] = useState<{ seq: number[]; from: number; to: number } | null>(null);
  const [appearing, setAppearing] = useState(false);
  const previous = useRef(digit);
  const element = useRef<HTMLSpanElement>(null);
  const directionRef = useRef(direction);
  directionRef.current = direction;

  useEffect(() => {
    if (newLeadingDigit && !element.current?.closest(".cleaning-transition-active")) setAppearing(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (digit === previous.current && !signChanged) return;
    const old = previous.current;
    previous.current = digit;
    if (signChanged || element.current?.closest(".cleaning-transition-active") || (mode === "strip" && directionRef.current === 0)) {
      setRoll(null);
      return;
    }
    let next: { seq: number[]; from: number; to: number };
    const steps = directionRef.current < 0 ? (old - digit + 10) % 10 : (digit - old + 10) % 10;
    if (mode === "step" || steps > 5) {
      // Ett steg: uppåt vid ökning, nedåt vid minskning
      next = directionRef.current < 0 ? { seq: [digit, old], from: 1, to: 0 } : { seq: [old, digit], from: 0, to: 1 };
    } else if (directionRef.current > 0) {
      next = { seq: Array.from({ length: steps + 1 }, (_, i) => (old + i) % 10), from: 0, to: steps };
    } else {
      next = { seq: Array.from({ length: steps + 1 }, (_, i) => (digit + i) % 10), from: steps, to: 0 };
    }
    setRoll(next);
  }, [digit, mode, signChanged]);

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
      ) : appearing ? <span className="animate-in fade-in" style={{ animationDuration: `${duration}ms` }} onAnimationEnd={() => setAppearing(false)}>{digit}</span> : digit}
    </span>
  );
});

export const RollingNumber = memo(function RollingNumber({ value, decimals, mutedLastDigit = false, suffix, direction: forcedDirection, maxDuration, mode = "strip" }: RollingNumberProps) {
  const { isTvMode } = useTvMode();
  const duration = Math.min(isTvMode ? DURATION_TV : DURATION_DESKTOP, maxDuration ?? Infinity);
  const formatted = typeof value === "number" ? value.toFixed(decimals ?? 0) : value;
  const previous = useRef(Number(formatted));
  const numeric = Number(formatted);
  const signChanged = Math.sign(numeric) !== Math.sign(previous.current) && (numeric < 0 || previous.current < 0);
  const direction = signChanged ? 0 : forcedDirection ?? Math.sign(Math.abs(numeric) - Math.abs(previous.current));
  const unsigned = formatted.replace(/^[+-]/, "");
  const decimalIndex = unsigned.indexOf(".") < 0 ? unsigned.length : unsigned.indexOf(".");
  const previousIntegerDigits = useRef(decimalIndex);
  useEffect(() => { previous.current = numeric; previousIntegerDigits.current = decimalIndex; }, [numeric, decimalIndex]);

  return (
    <span className="inline-flex items-baseline whitespace-nowrap tabular-nums leading-none" aria-label={`${formatted}${typeof suffix === "string" ? suffix : ""}`}>
      {formatted !== unsigned && <span key="sign">{formatted[0]}</span>}
      {Array.from(unsigned).map((char, i) => {
        const position = i < decimalIndex ? decimalIndex - i - 1 : decimalIndex - i;
        return (
          <span key={char === "." ? "decimal" : `digit-${position}`} className={mutedLastDigit && i === unsigned.length - 1 ? "text-muted-foreground/40" : undefined}>
            {/\d/.test(char) ? <RollingDigit digit={Number(char)} direction={direction} duration={duration} mode={mode} signChanged={signChanged} newLeadingDigit={!signChanged && position >= previousIntegerDigits.current} /> : char}
          </span>
        );
      })}
      {suffix}
    </span>
  );
});