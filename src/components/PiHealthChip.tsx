import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Cpu } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HeaderIconButton } from "./header/HeaderIconButton";

export function PiHealthChip() {
  const [lastHeartbeat, setLastHeartbeat] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data } = await supabase
        .from("pi_live_state")
        .select("last_heartbeat")
        .order("last_heartbeat", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (mounted) setLastHeartbeat(data?.last_heartbeat ?? null);
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

  // Pi:n hörs av via telemetrin: live var 30 s, rollup var 3 min.
  const ageSec = lastHeartbeat
    ? (now - new Date(lastHeartbeat).getTime()) / 1000
    : Infinity;
  const online = ageSec < 300;

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
