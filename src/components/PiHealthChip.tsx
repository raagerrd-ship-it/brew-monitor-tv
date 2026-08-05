import { memo, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Cpu } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HeaderIconButton } from "./header/HeaderIconButton";

function PiHealthChipInner() {
  // Endast två state-värden som faktiskt påverkar renderingen:
  // senaste heartbeat (ändras sällan) och online-flaggan.
  const [lastHeartbeat, setLastHeartbeat] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const heartbeatRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;

    // Pi:n hörs av via telemetrin: live var 30 s, rollup var 3 min.
    const evaluate = () => {
      const hb = heartbeatRef.current;
      const isOnline = hb
        ? (Date.now() - new Date(hb).getTime()) / 1000 < 300
        : false;
      setOnline((prev) => (prev === isOnline ? prev : isOnline));
    };

    const load = async () => {
      const { data } = await supabase
        .from("pi_live_state")
        .select("last_heartbeat")
        .order("last_heartbeat", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!mounted) return;
      const next = data?.last_heartbeat ?? null;
      if (next !== heartbeatRef.current) {
        heartbeatRef.current = next;
        setLastHeartbeat(next);
      }
      evaluate();
    };

    load();
    const iv = setInterval(load, 30000);
    const tick = setInterval(evaluate, 15000);
    return () => {
      mounted = false;
      clearInterval(iv);
      clearInterval(tick);
    };
  }, []);

  const ageSec = lastHeartbeat
    ? (Date.now() - new Date(lastHeartbeat).getTime()) / 1000
    : Infinity;

  const tooltip = (
    <div className="text-xs space-y-1">
      <div>
        <span className="opacity-70">Status:</span>{" "}
        {online ? "online" : "offline"}
      </div>
      {lastHeartbeat && (
        <div>
          <span className="opacity-70">Senaste telemetri:</span>{" "}
          {Math.round(ageSec)}s sedan
        </div>
      )}
    </div>
  );

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <HeaderIconButton
            icon={<Cpu strokeWidth={2} />}
            label={`Pi: ${online ? "online" : "offline"}`}
            active={online}
            dotColor={online ? undefined : "hsl(0 70% 55%)"}
            iconColor={online ? "hsl(142 60% 55%)" : "hsl(0 70% 60%)"}
          />
        </TooltipTrigger>
        <TooltipContent side="bottom">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export const PiHealthChip = memo(PiHealthChipInner);
