import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Snowflake, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";

interface LearnedMargin {
  controller_id: string;
  controller_name: string;
  bucket: string;
  learned_value: number;
  sample_count: number;
  last_updated_at: string;
}

const BUCKET_LABELS: Record<string, string> = {
  cold: "Kall (<5°)",
  cool: "Sval (5–12°)",
  warm: "Varm (12–18°)",
  hot: "Het (>18°)",
};

const BUCKET_ORDER = ["cold", "cool", "warm", "hot"];

export function LearnedCoolerMarginValues() {
  const [entries, setEntries] = useState<LearnedMargin[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const { data: learnings } = await supabase
        .from("fermentation_learnings")
        .select("controller_id, parameter_name, learned_value, sample_count, last_updated_at")
        .like("parameter_name", "cooler_margin:%")
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
          bucket: l.parameter_name.replace("cooler_margin:", ""),
          learned_value: l.learned_value,
          sample_count: l.sample_count,
          last_updated_at: l.last_updated_at,
        }))
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

  // Group by controller
  const grouped = entries.reduce<Record<string, LearnedMargin[]>>((acc, e) => {
    (acc[e.controller_name] ??= []).push(e);
    return acc;
  }, {});

  // Sort buckets within each group
  for (const items of Object.values(grouped)) {
    items.sort((a, b) => BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket));
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Snowflake className="h-4 w-4 text-blue-400" />
          <span className="text-sm font-medium">Inlärda kylarmarginaler</span>
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
              key={`${item.controller_id}-${item.bucket}`}
              className="flex items-center justify-between gap-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs text-muted-foreground">{BUCKET_LABELS[item.bucket] ?? item.bucket}</span>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-blue-500/10 text-blue-400 border-blue-500/30">
                  {item.learned_value.toFixed(1)}°C
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
