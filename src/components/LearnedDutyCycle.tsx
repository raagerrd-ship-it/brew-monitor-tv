import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Gauge, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatRecency } from "@/lib/format-recency";

interface DutyEntry {
  controller_id: string;
  controller_name: string;
  temp_bucket: string;
  duty: number;
  warming_rate: number;
  cooling_rate: number;
  sample_count: number;
  last_updated_at: string;
}

const BUCKET_LABELS: Record<string, string> = {
  cold: "Kall (<8°C)",
  cool: "Sval (8–14°C)",
  warm: "Varm (14–20°C)",
  hot: "Het (>20°C)",
};

const BUCKET_ORDER = ["cold", "cool", "warm", "hot"];

export function LearnedDutyCycle() {
  const [entries, setEntries] = useState<DutyEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      // Load duty cycle entries
      const { data: dutyLearnings } = await supabase
        .from("fermentation_learnings")
        .select("controller_id, parameter_name, learned_value, sample_count, last_updated_at")
        .like("parameter_name", "steady_state_duty:%")
        .order("last_updated_at", { ascending: false });

      if (!dutyLearnings || dutyLearnings.length === 0) {
        setEntries([]);
        setLoading(false);
        return;
      }

      const controllerIds = [...new Set(dutyLearnings.map((l) => l.controller_id))];

      // Load controller names + warming/cooling rates in parallel
      const [{ data: controllers }, { data: warmingLearnings }, { data: coolingLearnings }] = await Promise.all([
        supabase
          .from("rapt_temp_controllers")
          .select("controller_id, name")
          .in("controller_id", controllerIds),
        supabase
          .from("fermentation_learnings")
          .select("controller_id, parameter_name, learned_value")
          .in("controller_id", controllerIds)
          .like("parameter_name", "warming_rate:%"),
        supabase
          .from("fermentation_learnings")
          .select("controller_id, learned_value")
          .in("controller_id", controllerIds)
          .eq("parameter_name", "thermal_rate_cooling"),
      ]);

      const nameMap = new Map(controllers?.map((c) => [c.controller_id, c.name]) ?? []);
      const warmingMap = new Map(
        warmingLearnings?.map((l) => [`${l.controller_id}:${l.parameter_name.replace("warming_rate:", "")}`, l.learned_value]) ?? []
      );
      const coolingMap = new Map(
        coolingLearnings?.map((l) => [l.controller_id, l.learned_value]) ?? []
      );

      setEntries(
        dutyLearnings.map((l) => {
          const bucket = l.parameter_name.replace("steady_state_duty:", "");
          return {
            controller_id: l.controller_id,
            controller_name: nameMap.get(l.controller_id) ?? l.controller_id.slice(0, 8),
            temp_bucket: bucket,
            duty: l.learned_value,
            warming_rate: warmingMap.get(`${l.controller_id}:${bucket}`) ?? 0,
            cooling_rate: coolingMap.get(l.controller_id) ?? 0,
            sample_count: l.sample_count,
            last_updated_at: l.last_updated_at,
          };
        })
      );
    } catch (e) {
      console.error("Error loading duty cycle learnings:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return <p className="text-xs text-muted-foreground">Laddar steady-state duty cycle…</p>;
  }

  if (entries.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Gauge className="h-3.5 w-3.5" />
        <span>Inga inlärda duty cycles ännu. Beräknas från warming/cooling-hastigheter under drift.</span>
      </div>
    );
  }

  const grouped = entries.reduce<Record<string, DutyEntry[]>>((acc, e) => {
    (acc[e.controller_name] ??= []).push(e);
    return acc;
  }, {});

  for (const items of Object.values(grouped)) {
    items.sort((a, b) => BUCKET_ORDER.indexOf(a.temp_bucket) - BUCKET_ORDER.indexOf(b.temp_bucket));
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-medium">Steady-state duty cycle</span>
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
                <th className="text-left font-medium pb-1 w-[25%]">Zon</th>
                <th className="text-right font-medium pb-1 w-[15%]">Duty</th>
                <th className="text-right font-medium pb-1 w-[20%]">Burst</th>
                <th className="text-right font-medium pb-1 w-[20%]">W/K °C/h</th>
                <th className="text-right font-medium pb-1 w-[20%]">Senast</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {items.map((item) => {
                const rawPct = Math.round(item.duty * 100);
                const quantized = Math.round(item.duty * 10) * 10;
                const totalBurstMin = quantized / 10; // 0–10 over 10-min window
                const color = quantized > 60 ? "text-red-400" : quantized > 40 ? "text-yellow-400" : "text-emerald-400";
                return (
                  <tr key={`${item.controller_id}-${item.temp_bucket}`}>
                    <td className="py-1.5">{BUCKET_LABELS[item.temp_bucket] ?? item.temp_bucket}</td>
                    <td className={`py-1.5 text-right font-mono ${color}`}>{quantized}%</td>
                    <td className="py-1.5 text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((s) => (
                          <div
                            key={s}
                            className={`h-2.5 w-1 rounded-[1px] ${s <= totalBurstMin ? (quantized > 60 ? "bg-red-400" : quantized > 40 ? "bg-yellow-400" : "bg-emerald-400") : "bg-muted-foreground/20"}`}
                          />
                        ))}
                        <span className="ml-1 font-mono text-muted-foreground text-[10px]">
                          {totalBurstMin > 0 ? `${totalBurstMin}m` : "—"}
                        </span>
                      </div>
                    </td>
                    <td className="py-1.5 text-right text-muted-foreground font-mono text-[10px]">
                      {item.warming_rate > 0 ? item.warming_rate.toFixed(2) : "—"}/{item.cooling_rate > 0 ? item.cooling_rate.toFixed(2) : "—"}
                    </td>
                    <td className="py-1.5 text-right text-muted-foreground">{formatRecency(item.last_updated_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      <p className="text-[10px] text-muted-foreground/60 italic">
        PWM kvantiseras i 1-minuts steg (pg_cron): 0%, 20%, 40%, 60%, 80%, 100%. Burst = duty-steg × 1 min per 5-min cykel.
      </p>
    </div>
  );
}
