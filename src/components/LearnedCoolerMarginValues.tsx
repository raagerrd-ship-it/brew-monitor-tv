import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Snowflake, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatRecency } from "@/lib/format-recency";

interface LearnedMargin {
  controller_id: string;
  controller_name: string;
  kind: "hold" | "ramp" | "generic";
  bucket: string;
  learned_value: number;
  sample_count: number;
  last_updated_at: string;
  min_effective?: number | null;
}

const BUCKET_LABELS: Record<string, string> = {
  cold: "Kall (<5°)",
  cool: "Sval (5–12°)",
  warm: "Varm (12–18°)",
  hot: "Het (>18°)",
};

const LOAD_LABELS: Record<string, string> = {
  load_0: "0 tankar",
  load_1: "1 tank",
  load_2plus: "2+ tankar",
};

const ACTIVITY_LABELS: Record<string, string> = {
  activity_low: "låg",
  activity_med: "med",
  activity_high: "hög",
};

const BUCKET_LABELS_SHORT: Record<string, string> = {
  cold: "Kall",
  cool: "Sval",
  warm: "Varm",
  hot: "Het",
};

const LOAD_LABELS_SHORT: Record<string, string> = {
  load_0: "0t",
  load_1: "1t",
  load_2plus: "2t+",
};

const KIND_LABELS: Record<LearnedMargin["kind"], string> = {
  hold: "Håll",
  ramp: "Sänk",
  generic: "Generisk",
};

const KIND_COLORS: Record<LearnedMargin["kind"], string> = {
  hold: "text-emerald-400",
  ramp: "text-orange-400",
  generic: "text-muted-foreground",
};

const BUCKET_ORDER = ["cold", "cool", "warm", "hot"];

function formatBucketLabel(bucket: string): string {
  const parts = bucket.split(":");
  const labels = parts.map((p) => {
    return BUCKET_LABELS[p] ?? LOAD_LABELS[p] ?? ACTIVITY_LABELS[p] ?? p;
  });
  return labels.join(" · ");
}

function formatBucketLabelShort(bucket: string): string {
  const parts = bucket.split(":");
  const labels = parts.map((p) => {
    return BUCKET_LABELS_SHORT[p] ?? LOAD_LABELS_SHORT[p] ?? ACTIVITY_LABELS[p] ?? p;
  });
  return labels.join(" · ");
}

export function LearnedCoolerMarginValues() {
  const [entries, setEntries] = useState<LearnedMargin[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const { data: learnings } = await supabase
        .from("fermentation_learnings")
        .select("controller_id, parameter_name, learned_value, sample_count, last_updated_at")
        .or(
          "parameter_name.like.cooler_margin:%,parameter_name.like.hold_margin:%,parameter_name.like.ramp_margin:%"
        )
        .order("last_updated_at", { ascending: false });

      if (!learnings || learnings.length === 0) {
        setEntries([]);
        setLoading(false);
        return;
      }

      const { data: minEffectives } = await supabase
        .from("fermentation_learnings")
        .select("controller_id, parameter_name, learned_value")
        .like("parameter_name", "min_effective_margin:%");

      const minEffMap = new Map<string, number>();
      minEffectives?.forEach((m) => {
        const bucket = m.parameter_name.replace("min_effective_margin:", "");
        minEffMap.set(`${m.controller_id}:${bucket}`, parseFloat(String(m.learned_value)));
      });

      const controllerIds = [...new Set(learnings.map((l) => l.controller_id))];
      const { data: controllers } = await supabase
        .from("rapt_temp_controllers")
        .select("controller_id, name")
        .in("controller_id", controllerIds);

      const nameMap = new Map(controllers?.map((c) => [c.controller_id, c.name]) ?? []);

      setEntries(
        learnings.map((l) => {
          let kind: LearnedMargin["kind"] = "generic";
          let raw = l.parameter_name;
          if (raw.startsWith("hold_margin:")) {
            kind = "hold";
            raw = raw.replace("hold_margin:", "");
          } else if (raw.startsWith("ramp_margin:")) {
            kind = "ramp";
            raw = raw.replace("ramp_margin:", "");
          } else {
            raw = raw.replace("cooler_margin:", "");
          }
          return {
            controller_id: l.controller_id,
            controller_name: nameMap.get(l.controller_id) ?? l.controller_id.slice(0, 8),
            kind,
            bucket: raw,
            learned_value: l.learned_value,
            sample_count: l.sample_count,
            last_updated_at: l.last_updated_at,
            min_effective: minEffMap.get(`${l.controller_id}:${raw}`) ?? null,
          };
        })
      );
    } catch (e) {
      console.error("Error loading cooler margin learnings:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return <p className="text-xs text-muted-foreground">Laddar inlärda kylarmarginaler…</p>;
  }

  if (entries.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Snowflake className="h-3.5 w-3.5" />
        <span>Inga inlärda kylarmarginaler ännu. Systemet lär sig automatiskt under drift.</span>
      </div>
    );
  }

  const grouped = entries.reduce<Record<string, LearnedMargin[]>>((acc, e) => {
    (acc[e.controller_name] ??= []).push(e);
    return acc;
  }, {});

  for (const items of Object.values(grouped)) {
    items.sort((a, b) => {
      const kindOrder = { hold: 0, ramp: 1, generic: 2 } as const;
      if (a.kind !== b.kind) return kindOrder[a.kind] - kindOrder[b.kind];
      const aBase = a.bucket.split(":")[0];
      const bBase = b.bucket.split(":")[0];
      const aIdx = BUCKET_ORDER.indexOf(aBase);
      const bIdx = BUCKET_ORDER.indexOf(bBase);
      if (aIdx !== bIdx) return aIdx - bIdx;
      const aHasLoad = a.bucket.includes(":");
      const bHasLoad = b.bucket.includes(":");
      if (aHasLoad !== bHasLoad) return aHasLoad ? 1 : -1;
      return a.bucket.localeCompare(b.bucket);
    });
  }

  const hasAnyMinEff = entries.some((e) => e.min_effective != null);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Snowflake className="h-4 w-4 text-blue-400" />
          <span className="text-sm font-medium">Kylarmarginaler</span>
        </div>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={loadData}>
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      {Object.entries(grouped).map(([name, items]) => (
        <div key={name} className="space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">{name}</span>
          <div className="rounded-md border border-border/40 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/40 bg-muted/30">
                  <th className="text-left font-medium text-[10px] uppercase tracking-wider text-muted-foreground/70 px-3 py-2">Typ</th>
                  <th className="text-left font-medium text-[10px] uppercase tracking-wider text-muted-foreground/70 px-3 py-2">Zon</th>
                  <th className="text-right font-medium text-[10px] uppercase tracking-wider text-muted-foreground/70 px-3 py-2">Marginal</th>
                  {hasAnyMinEff && <th className="text-right font-medium text-[10px] uppercase tracking-wider text-muted-foreground/70 px-3 py-2">Min</th>}
                  <th className="text-right font-medium text-[10px] uppercase tracking-wider text-muted-foreground/70 px-3 py-2">Prov</th>
                  <th className="text-right font-medium text-[10px] uppercase tracking-wider text-muted-foreground/70 px-3 py-2">Senast</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={`${item.controller_id}-${item.kind}-${item.bucket}`} className={idx < items.length - 1 ? "border-b border-border/20" : ""}>
                    <td className={`px-3 py-2 font-medium ${KIND_COLORS[item.kind]}`}>{KIND_LABELS[item.kind]}</td>
                    <td className="px-3 py-2">{formatBucketLabel(item.bucket)}</td>
                    <td className="px-3 py-2 text-right font-mono text-blue-400">{item.learned_value.toFixed(1)}°C</td>
                    {hasAnyMinEff && (
                      <td className="px-3 py-2 text-right font-mono text-green-400">
                        {item.min_effective != null ? `${item.min_effective.toFixed(1)}°C` : "–"}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right text-muted-foreground">{item.sample_count}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{formatRecency(item.last_updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
