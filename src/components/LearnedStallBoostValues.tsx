import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Flame, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";

interface LearnedBoost {
  controller_id: string;
  controller_name: string;
  learned_value: number;
  sample_count: number;
  last_updated_at: string;
}

export function LearnedStallBoostValues() {
  const [entries, setEntries] = useState<LearnedBoost[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const { data: learnings } = await supabase
        .from("fermentation_learnings")
        .select("controller_id, parameter_name, learned_value, sample_count, last_updated_at")
        .eq("parameter_name", "stall_boost_degrees")
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
          learned_value: l.learned_value,
          sample_count: l.sample_count,
          last_updated_at: l.last_updated_at,
        }))
      );
    } catch (e) {
      console.error("Error loading stall boost learnings:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return <p className="text-xs text-muted-foreground">Laddar inlärda boost-värden…</p>;
  }

  if (entries.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Flame className="h-3.5 w-3.5" />
        <span>Inga inlärda stall-boost ännu. Värden sparas efter första stall-detekteringen.</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-orange-400" />
          <span className="text-sm font-medium">Inlärda stall-boost</span>
        </div>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={loadData}>
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      <div className="space-y-1.5">
        {entries.map((entry) => (
          <div
            key={entry.controller_id}
            className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/20 px-3 py-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-medium truncate">{entry.controller_name}</span>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-orange-500/10 text-orange-400 border-orange-500/30">
                +{entry.learned_value.toFixed(1)}°C
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground shrink-0">
              <span>{entry.sample_count} mätningar</span>
              <span className="text-muted-foreground/50">·</span>
              <span>{formatDistanceToNow(new Date(entry.last_updated_at), { locale: sv, addSuffix: true })}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
