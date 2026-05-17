import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { TrendingDown, TrendingUp, RefreshCw, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatRecency } from "@/lib/format-recency";

interface MarginHistoryEntry {
  controller_id: string;
  temp_bucket: string;
  margin_value: number;
  min_effective: number | null;
  utilization: number | null;
  cooling_rate: number | null;
  sample_count: number;
  recorded_at: string;
}

interface GroupedHistory {
  bucket: string;
  entries: MarginHistoryEntry[];
  trend: "up" | "down" | "stable";
  currentMargin: number;
  oldestMargin: number;
}

const BUCKET_LABELS: Record<string, string> = {
  cold: "Kall (<5°)",
  cool: "Sval (5–12°)",
  warm: "Varm (12–18°)",
  hot: "Het (>18°)",
};

const BUCKET_ORDER = ["cold", "cool", "warm", "hot"];

function formatBucket(bucket: string): string {
  const parts = bucket.split(":");
  return BUCKET_LABELS[parts[0]] ?? parts[0];
}

export function LearnedMarginHistory() {
  const [data, setData] = useState<Map<string, GroupedHistory[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [controllerNames, setControllerNames] = useState<Map<string, string>>(new Map());

  const loadData = useCallback(async () => {
    try {
      const { data: history } = await (supabase as any)
        .from("cooler_margin_history")
        .select("controller_id, temp_bucket, margin_value, max_effective, utilization, cooling_rate, sample_count, recorded_at")
        .order("recorded_at", { ascending: false })
        .limit(500);

      if (!history || history.length === 0) {
        setData(new Map());
        setLoading(false);
        return;
      }

      const controllerIds = [...new Set(history.map((h: any) => h.controller_id))];
      const { data: controllers } = await supabase
        .from("rapt_temp_controllers")
        .select("controller_id, name")
        .in("controller_id", controllerIds as string[]);

      const nameMap = new Map(controllers?.map((c) => [c.controller_id, c.name]) ?? []);
      setControllerNames(nameMap);

      // Group by controller -> bucket
      const byController = new Map<string, Map<string, MarginHistoryEntry[]>>();
      for (const h of history as MarginHistoryEntry[]) {
        if (!byController.has(h.controller_id)) byController.set(h.controller_id, new Map());
        const bucketMap = byController.get(h.controller_id)!;
        if (!bucketMap.has(h.temp_bucket)) bucketMap.set(h.temp_bucket, []);
        bucketMap.get(h.temp_bucket)!.push(h);
      }

      const result = new Map<string, GroupedHistory[]>();
      for (const [controllerId, bucketMap] of byController) {
        const groups: GroupedHistory[] = [];
        for (const [bucket, entries] of bucketMap) {
          const sorted = entries.sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());
          const current = sorted[0].margin_value;
          const oldest = sorted[sorted.length - 1].margin_value;
          const diff = current - oldest;
          const trend = Math.abs(diff) < 0.3 ? "stable" : diff > 0 ? "up" : "down";

          groups.push({ bucket, entries: sorted, trend, currentMargin: current, oldestMargin: oldest });
        }
        groups.sort((a, b) => {
          const aIdx = BUCKET_ORDER.indexOf(a.bucket.split(":")[0]);
          const bIdx = BUCKET_ORDER.indexOf(b.bucket.split(":")[0]);
          return aIdx - bIdx;
        });
        result.set(controllerId, groups);
      }

      setData(result);
    } catch (e) {
      console.error("Error loading margin history:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return <p className="text-xs text-muted-foreground">Laddar marginalhistorik…</p>;
  }

  if (data.size === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <History className="h-3.5 w-3.5" />
        <span>Ingen marginalhistorik ännu. Loggas vid varje automationscykel.</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-blue-400" />
          <span className="text-sm font-medium">Marginalutveckling</span>
        </div>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={loadData}>
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      {[...data.entries()].map(([controllerId, groups]) => (
        <div key={controllerId} className="space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">
            {controllerNames.get(controllerId) ?? controllerId.slice(0, 8)}
          </span>

          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
                <th className="text-left font-medium pb-1">Zon</th>
                <th className="text-right font-medium pb-1">Nu</th>
                <th className="text-right font-medium pb-1">Trend</th>
                <th className="text-right font-medium pb-1">Util</th>
                <th className="text-right font-medium pb-1">Prov</th>
                <th className="text-right font-medium pb-1">Senast</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {groups.map((group) => {
                const latestUtil = group.entries[0].utilization;
                const totalSamples = group.entries.length;
                const change = group.currentMargin - group.oldestMargin;

                return (
                  <tr key={group.bucket}>
                    <td className="py-1.5">{formatBucket(group.bucket)}</td>
                    <td
                      className="py-1.5 text-right font-mono text-blue-400"
                      title="Worst-case marginal (innan kompressorn slår till). Kommanderad marginal = denna + kylarens hysteres."
                    >
                      {group.currentMargin.toFixed(1)}°C
                    </td>
                    <td className="py-1.5 text-right">
                      <span className={`inline-flex items-center gap-0.5 font-mono ${
                        group.trend === "down" ? "text-green-400" : group.trend === "up" ? "text-amber-400" : "text-muted-foreground"
                      }`}>
                        {group.trend === "down" ? (
                          <TrendingDown className="h-3 w-3" />
                        ) : group.trend === "up" ? (
                          <TrendingUp className="h-3 w-3" />
                        ) : null}
                        {change > 0 ? "+" : ""}{change.toFixed(1)}°
                      </span>
                    </td>
                    <td className="py-1.5 text-right font-mono text-muted-foreground">
                      {latestUtil != null ? `${Math.round(latestUtil * 100)}%` : "–"}
                    </td>
                    <td className="py-1.5 text-right text-muted-foreground">{totalSamples}</td>
                    <td className="py-1.5 text-right text-muted-foreground">
                      {formatRecency(group.entries[0].recorded_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
