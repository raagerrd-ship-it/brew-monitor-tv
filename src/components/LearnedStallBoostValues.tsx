import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Flame, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatRecency } from "@/lib/format-recency";

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
          <span className="text-sm font-medium">Stall-boost</span>
        </div>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={loadData}>
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
            <th className="text-left font-medium pb-1.5">Controller</th>
            <th className="text-right font-medium pb-1.5">Boost</th>
            <th className="text-right font-medium pb-1.5">Mätningar</th>
            <th className="text-right font-medium pb-1.5">Senast</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/30">
          {entries.map((entry) => (
            <tr key={entry.controller_id}>
              <td className="py-1.5 font-medium">{entry.controller_name}</td>
              <td className="py-1.5 text-right font-mono text-orange-400">+{entry.learned_value.toFixed(1)}°C</td>
              <td className="py-1.5 text-right text-muted-foreground">{entry.sample_count}</td>
              <td className="py-1.5 text-right text-muted-foreground">{formatRecency(entry.last_updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
