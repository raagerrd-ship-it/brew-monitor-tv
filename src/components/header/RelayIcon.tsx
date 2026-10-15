import { useRef } from "react";
import { Flame, Snowflake } from "lucide-react";
import { useTvEventAnimation } from "@/hooks/use-tv-event-animation";

export function RelayIcon({ on, heat = false, isTvMode }: { on: boolean | null | undefined; heat?: boolean; isTvMode: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useTvEventAnimation(ref, on, 'tv-relay-pop', isTvMode);
  const Icon = heat ? Flame : Snowflake;
  return <span ref={ref} className={`${isTvMode && on !== true ? 'hidden' : 'inline-flex'} ${on ? (heat ? 'text-warning' : 'text-accent') : 'text-muted-foreground'}`} style={{ opacity: on ? 1 : 0.3 }} title={`${heat ? 'Värme' : 'Kyla'}: ${on == null ? 'okänt' : on ? 'PÅ' : 'AV'}`}>
    <Icon className="h-3 w-3" />
  </span>;
}