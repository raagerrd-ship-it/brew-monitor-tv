import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Zap } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface PiHealth {
  last_seen: string | null;
  undervoltage_now: boolean | null;
  undervoltage_ever: boolean | null;
  throttled_hex: string | null;
  temp_c: number | null;
  uptime_sec: number | null;
  load1: number | null;
}

function formatUptime(sec: number | null): string {
  if (!sec) return "–";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}t ${m}m`;
  return `${m}m`;
}

export function PiHealthChip() {
  const [health, setHealth] = useState<PiHealth | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data } = await supabase
        .from("pi_health")
        .select("last_seen, undervoltage_now, undervoltage_ever, throttled_hex, temp_c, uptime_sec, load1")
        .eq("id", 1)
        .maybeSingle();
      if (mounted && data) setHealth(data as PiHealth);
    };
    load();
    const iv = setInterval(load, 30000);
    const tick = setInterval(() => setNow(Date.now()), 15000);
    return () => {
      mounted = false;
      clearInterval(iv);
      clearInterval(tick);
    };
  }, []);

  const ageSec = health?.last_seen
    ? (now - new Date(health.last_seen).getTime()) / 1000
    : Infinity;
  const online = ageSec < 90;
  const undervoltage = !!(health?.undervoltage_now || health?.undervoltage_ever);
  const dotColor = online ? "hsl(142 70% 45%)" : "hsl(0 70% 50%)";
  const labelColor = online ? "hsl(0 0% 85%)" : "hsl(0 70% 60%)";

  const tooltip = (
    <div className="text-xs space-y-1">
      <div>
        <span className="opacity-70">Status:</span>{" "}
        {online ? "online" : "offline"}
      </div>
      {health?.last_seen && (
        <div>
          <span className="opacity-70">Senast sedd:</span>{" "}
          {Math.round(ageSec)}s sedan
        </div>
      )}
      {health?.temp_c != null && (
        <div>
          <span className="opacity-70">Temp:</span> {health.temp_c.toFixed(1)}°C
        </div>
      )}
      {health?.uptime_sec != null && (
        <div>
          <span className="opacity-70">Uptime:</span>{" "}
          {formatUptime(health.uptime_sec)}
        </div>
      )}
      {health?.load1 != null && (
        <div>
          <span className="opacity-70">Load1:</span> {health.load1.toFixed(2)}
        </div>
      )}
      {undervoltage && (
        <div className="pt-1 text-[hsl(38_92%_55%)]">
          ⚡ Underspänning{" "}
          {health?.undervoltage_now ? "just nu" : "upptäckt tidigare"}
          {health?.throttled_hex ? ` (${health.throttled_hex})` : ""}
          <br />
          Kontrollera Pi:ns strömförsörjning
        </div>
      )}
    </div>
  );

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className="flex items-center gap-1.5 px-2 h-7 rounded-full"
            style={{
              background: "hsl(0 0% 100% / 0.04)",
              border: "1px solid hsl(0 0% 100% / 0.08)",
            }}
          >
            <span
              className="inline-block rounded-full"
              style={{
                width: 7,
                height: 7,
                background: dotColor,
                boxShadow: `0 0 6px ${dotColor}`,
              }}
            />
            <span
              className="text-[11px] font-medium tabular-nums"
              style={{ color: labelColor }}
            >
              Pi
            </span>
            {undervoltage && (
              <Zap
                className="w-3 h-3"
                style={{
                  color: "hsl(38 92% 55%)",
                  filter: "drop-shadow(0 0 3px hsl(38 92% 55% / 0.6))",
                }}
              />
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}