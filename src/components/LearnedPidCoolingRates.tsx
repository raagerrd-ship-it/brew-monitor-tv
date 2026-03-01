import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Zap, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";

interface LearnedRate {
  controller_id: string;
  controller_name: string;
  load_bucket: string;
  rate: number;
  sample_count: number;
  last_updated_at: string;
}

const LOAD_LABELS: Record<string, string> = {
  load_0: "0 tankar",
  load_1: "1 tank",
  load_2plus: "2+ tankar",
};

const LOAD_ORDER = ["load_0", "load_1", "load_2plus"];

export function LearnedPidCoolingRates() {
  const [entries, setEntries] = useState<LearnedRate[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const { data: learnings } = await supabase
        .from("fermentation_learnings")
        .select("controller_id, parameter_name, learned_value, sample_count, last_updated_at")
        .like("parameter_name", "glycol_rate:%")
        .order("last_updated_at", { ascending: false });

      if (!learnings || learnings.length === 0) {
        setEntries([]);
        setLoading(false);
        return;
      }

      const controllerIds = [...new Set(learnings.map((l) => l.controller_id))];
      const { data: controllers } = await supabase
        .from("rapt_temp_controllers")
        .select("controller_id, name")
        .in("controller_id", controllerIds);

      const nameMap = new Map(controllers?.map((c) => [c.controller_id, c.name]) ?? []);

      setEntries(
        learnings.map((l) => ({
          controller_id: l.controller_id,
          controller_name: nameMap.get(l.controller_id) ?? l.controller_id.slice(0, 8),
          load_bucket: l.parameter_name.replace("glycol_rate:", ""),
          rate: l.learned_value,
          sample_count: l.sample_count,
          last_updated_at: l.last_updated_at,
        }))
      );
    } catch (e) {
      console.error("Error loading glycol rate learnings:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return <p className="text-xs text-muted-foreground">Laddar inlärda PID-kylhastigheter…</p>;
  }

  if (entries.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Zap className="h-3.5 w-3.5" />
        <span>Inga inlärda PID-kylhastigheter ännu. Systemet lär sig automatiskt under drift.</span>
      </div>
    );
  }

  // Group by controller
  const grouped = entries.reduce<Record<string, LearnedRate[]>>((acc, e) => {
    (acc[e.controller_name] ??= []).push(e);
    return acc;
  }, {});

  for (const items of Object.values(grouped)) {
    items.sort((a, b) => LOAD_ORDER.indexOf(a.load_bucket) - LOAD_ORDER.indexOf(b.load_bucket));
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
           <Zap className="h-4 w-4 text-cyan-400" />
          <span className="text-sm font-medium">PID-kylhastigheter per last</span>
        </div>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={loadData}>
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      {Object.entries(grouped).map(([name, items]) => (
        <div key={name} className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-1.5">
          <span className="text-xs font-medium">{name}</span>
          {items.map((item) => (
            <div
              key={`${item.controller_id}-${item.load_bucket}`}
              className="flex items-center justify-between gap-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs text-muted-foreground">{LOAD_LABELS[item.load_bucket] ?? item.load_bucket}</span>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-cyan-500/10 text-cyan-400 border-cyan-500/30">
                  {item.rate.toFixed(2)}°C/h
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground shrink-0">
                <span>{item.sample_count} mätningar</span>
                <span className="text-muted-foreground/50">·</span>
                <span>{formatDistanceToNow(new Date(item.last_updated_at), { locale: sv, addSuffix: true })}</span>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
