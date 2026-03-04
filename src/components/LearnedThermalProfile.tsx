import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Thermometer, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatRecency } from "@/lib/format-recency";

interface LearnedEntry {
  controller_id: string;
  controller_name: string;
  param_type: string;
  bucket: string;
  load: string;
  value: number;
  sample_count: number;
  last_updated_at: string;
}

const BUCKET_LABELS: Record<string, string> = {
  cold: "Kall (<8°)",
  cool: "Sval (8–14°)",
  warm: "Varm (14–20°)",
  hot: "Het (>20°)",
};

const LOAD_LABELS: Record<string, string> = {
  load_0: "0 tankar",
  load_1: "1 tank",
  load_2plus: "2+ tankar",
};

const TYPE_LABELS: Record<string, { label: string; unit: string; color: string }> = {
  cooling_rate: { label: "Kylhastighet", unit: "°C/h", color: "text-blue-400" },
  warming_rate: { label: "Uppvärmning", unit: "°C/h", color: "text-orange-400" },
  hold_margin: { label: "Hold-marginal", unit: "°C", color: "text-emerald-400" },
  ramp_margin: { label: "Ramp-marginal", unit: "°C", color: "text-violet-400" },
  cooling_capacity: { label: "Max kylkapacitet", unit: "°C/h", color: "text-cyan-400" },
};

function parseParamName(paramName: string): { type: string; bucket: string; load: string } | null {
  // Patterns: cooling_rate:cold:load_1, warming_rate:cold, hold_margin:cold:load_1, cooling_capacity:load_1
  const types = ["cooling_rate", "warming_rate", "hold_margin", "ramp_margin", "cooling_capacity"];
  for (const t of types) {
    if (paramName.startsWith(`${t}:`)) {
      const rest = paramName.slice(t.length + 1);
      const parts = rest.split(":");
      if (t === "cooling_capacity") {
        return { type: t, bucket: "all", load: parts[0] || "" };
      }
      if (t === "warming_rate") {
        return { type: t, bucket: parts[0] || "", load: "" };
      }
      return { type: t, bucket: parts[0] || "", load: parts[1] || "" };
    }
  }
  return null;
}

export function LearnedThermalProfile() {
  const [entries, setEntries] = useState<LearnedEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const patterns = ["cooling_rate:%", "warming_rate:%", "hold_margin:%", "ramp_margin:%", "cooling_capacity:%"];
      const allEntries: LearnedEntry[] = [];

      const results = await Promise.all(
        patterns.map((p) =>
          supabase
            .from("fermentation_learnings")
            .select("controller_id, parameter_name, learned_value, sample_count, last_updated_at")
            .like("parameter_name", p)
            .order("last_updated_at", { ascending: false })
        )
      );

      const allLearnings = results.flatMap((r) => r.data ?? []);
      if (allLearnings.length === 0) {
        setEntries([]);
        setLoading(false);
        return;
      }

      const controllerIds = [...new Set(allLearnings.map((l) => l.controller_id))];
      const { data: controllers } = await supabase
        .from("rapt_temp_controllers")
        .select("controller_id, name")
        .in("controller_id", controllerIds);

      const nameMap = new Map(controllers?.map((c) => [c.controller_id, c.name]) ?? []);

      for (const l of allLearnings) {
        const parsed = parseParamName(l.parameter_name);
        if (!parsed) continue;
        allEntries.push({
          controller_id: l.controller_id,
          controller_name: nameMap.get(l.controller_id) ?? l.controller_id.slice(0, 8),
          param_type: parsed.type,
          bucket: parsed.bucket,
          load: parsed.load,
          value: l.learned_value,
          sample_count: l.sample_count,
          last_updated_at: l.last_updated_at,
        });
      }

      setEntries(allEntries);
    } catch (e) {
      console.error("Error loading thermal profile:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return <p className="text-xs text-muted-foreground">Laddar termisk profil…</p>;
  }

  if (entries.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Thermometer className="h-3.5 w-3.5" />
        <span>Ingen termisk profildata ännu. Systemet samlar in data under drift.</span>
      </div>
    );
  }

  // Group by param_type
  const byType = entries.reduce<Record<string, LearnedEntry[]>>((acc, e) => {
    (acc[e.param_type] ??= []).push(e);
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Thermometer className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Termisk profil</span>
        </div>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={loadData}>
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      {Object.entries(byType).map(([type, items]) => {
        const meta = TYPE_LABELS[type] ?? { label: type, unit: "", color: "text-foreground" };
        return (
          <div key={type} className="space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">{meta.label}</span>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
                  <th className="text-left font-medium pb-1">Zon</th>
                  {type !== "warming_rate" && <th className="text-left font-medium pb-1">Last</th>}
                  <th className="text-right font-medium pb-1">Värde</th>
                  <th className="text-right font-medium pb-1">Prov</th>
                  <th className="text-right font-medium pb-1">Senast</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {items.map((item, i) => (
                  <tr key={`${item.controller_id}-${item.param_type}-${item.bucket}-${item.load}-${i}`}>
                    <td className="py-1.5">
                      {item.bucket === "all" ? "Alla" : BUCKET_LABELS[item.bucket] ?? item.bucket}
                    </td>
                    {type !== "warming_rate" && (
                      <td className="py-1.5">{LOAD_LABELS[item.load] ?? (item.load || "–")}</td>
                    )}
                    <td className={`py-1.5 text-right font-mono ${meta.color}`}>
                      {item.value.toFixed(2)}{meta.unit}
                    </td>
                    <td className="py-1.5 text-right text-muted-foreground">{item.sample_count}</td>
                    <td className="py-1.5 text-right text-muted-foreground">{formatRecency(item.last_updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      <p className="text-[10px] text-muted-foreground/60 italic">
        Data samlas in passivt under normal drift. Hold- och ramp-marginaler optimeras separat.
      </p>
    </div>
  );
}
