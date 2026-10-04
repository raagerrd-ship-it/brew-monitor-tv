import { memo, useEffect, useRef, useState } from "react";
import { useTvMode } from "@/contexts/TvModeContext";

const DIGITS = Array.from({ length: 30 }, (_, i) => i % 10);
const CENTER = 10;
const DURATION_DESKTOP = 700;
const DURATION_TV = 2000;

interface RollingNumberProps {
  value: number | string;
  decimals?: number;
  mutedLastDigit?: boolean;
  suffix?: React.ReactNode;
  direction?: 1 | -1;
}

const RollingDigit = memo(function RollingDigit({ digit, direction, duration }: { digit: number; direction: number; duration: number }) {
  const [position, setPosition] = useState(CENTER + digit);
  const [animated, setAnimated] = useState(false);
  const previous = useRef(digit);
  const currentPosition = useRef(CENTER + digit);
  const element = useRef<HTMLSpanElement>(null);
  const directionRef = useRef(direction);
  directionRef.current = direction;

  useEffect(() => {
    if (digit === previous.current) return;
    const old = previous.current;
    previous.current = digit;
    if (directionRef.current === 0 || element.current?.closest(".cleaning-transition-active")) {
      currentPosition.current = CENTER + digit;
      setAnimated(false);
      setPosition(currentPosition.current);
      return;
    }
    const steps = directionRef.current > 0 ? (digit - old + 10) % 10 : -((old - digit + 10) % 10);
    currentPosition.current += steps;
    setAnimated(true);
    setPosition(currentPosition.current);
    const timer = window.setTimeout(() => {
      currentPosition.current = CENTER + digit;
      setAnimated(false);
      setPosition(currentPosition.current);
    }, 720);
    return () => window.clearTimeout(timer);
  }, [digit]);

  return (
    <span ref={element} aria-hidden="true" className="inline-block h-[1em] overflow-hidden align-baseline leading-none tabular-nums" style={{ verticalAlign: '-0.14em' }}>
      <span
        className="rolling-number-strip block leading-none"
        style={{
          transform: `translateY(-${position}em)`,
          transition: animated ? "transform 700ms cubic-bezier(0.2, 0.8, 0.2, 1)" : "none",
        }}
      >
        {DIGITS.map((n, i) => <span key={i} className="block h-[1em] leading-none">{n}</span>)}
      </span>
    </span>
  );
});

export const RollingNumber = memo(function RollingNumber({ value, decimals, mutedLastDigit = false, suffix, direction: forcedDirection }: RollingNumberProps) {
  const formatted = typeof value === "number" ? value.toFixed(decimals ?? 0) : value;
  const previous = useRef(Number(formatted));
  const numeric = Number(formatted);
  const direction = numeric === previous.current ? 0 : forcedDirection ?? (numeric > previous.current ? 1 : -1);
  useEffect(() => { previous.current = numeric; }, [numeric]);

  return (
    <span className="inline-flex items-baseline whitespace-nowrap tabular-nums leading-none" aria-label={`${formatted}${typeof suffix === "string" ? suffix : ""}`}>
      {Array.from(formatted).map((char, i) => (
        <span key={i} className={mutedLastDigit && i === formatted.length - 1 ? "text-muted-foreground/40" : undefined}>
          {/\d/.test(char) ? <RollingDigit digit={Number(char)} direction={direction} /> : char}
        </span>
      ))}
      {suffix}
    </span>
  );
});