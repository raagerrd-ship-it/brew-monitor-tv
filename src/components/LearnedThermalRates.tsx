import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Flame, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";

interface LearnedRate {
  controller_id: string;
  controller_name: string;
  mode: string;
  rate: number;
  sample_count: number;
  last_updated_at: string;
}

const MODE_LABELS: Record<string, string> = {
  heating: "Uppvärmning",
  cooling: "Kylning",
};

export function LearnedThermalRates() {
  const [entries, setEntries] = useState<LearnedRate[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const { data: learnings } = await supabase
        .from("fermentation_learnings")
        .select("controller_id, parameter_name, learned_value, sample_count, last_updated_at")
        .like("parameter_name", "thermal_rate_%")
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
          mode: l.parameter_name.replace("thermal_rate_", ""),
          rate: l.learned_value,
          sample_count: l.sample_count,
          last_updated_at: l.last_updated_at,
        }))
      );
    } catch (e) {
      console.error("Error loading thermal rate learnings:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return <p className="text-xs text-muted-foreground">Laddar inlärda hastigheter…</p>;
  }

  if (entries.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Flame className="h-3.5 w-3.5" />
        <span>Inga inlärda controller-hastigheter ännu. Systemet lär sig automatiskt under drift.</span>
      </div>
    );
  }

  // Group by controller
  const grouped = entries.reduce<Record<string, LearnedRate[]>>((acc, e) => {
    (acc[e.controller_name] ??= []).push(e);
    return acc;
  }, {});

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-orange-400" />
          <span className="text-sm font-medium">Termiska hastigheter</span>
        </div>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={loadData}>
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      {Object.entries(grouped).map(([name, items]) => (
        <div key={name} className="space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">{name}</span>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
                <th className="text-left font-medium pb-1">Läge</th>
                <th className="text-right font-medium pb-1">Hastighet</th>
                <th className="text-right font-medium pb-1">Mätningar</th>
                <th className="text-right font-medium pb-1">Senast</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {items.map((item) => (
                <tr key={`${item.controller_id}-${item.mode}`}>
                  <td className="py-1.5">{MODE_LABELS[item.mode] ?? item.mode}</td>
                  <td className={`py-1.5 text-right font-mono ${item.mode === 'heating' ? 'text-orange-400' : 'text-blue-400'}`}>
                    {item.rate.toFixed(2)}°C/h
                  </td>
                  <td className="py-1.5 text-right text-muted-foreground">{item.sample_count}</td>
                  <td className="py-1.5 text-right text-muted-foreground">{formatDistanceToNow(new Date(item.last_updated_at), { locale: sv, addSuffix: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <p className="text-[10px] text-muted-foreground/60 italic">
        PID-kompensation begränsas automatiskt när hastigheten når ≥80% av inlärd max (saturation).
      </p>
    </div>
  );
}
