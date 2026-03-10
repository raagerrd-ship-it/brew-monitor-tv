import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sliders, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatRecency } from "@/lib/format-recency";

const BUCKET_LABELS: Record<string, string> = {
  cold: "Kall",
  cool: "Sval",
  warm: "Varm",
  hot: "Het",
};

interface PerControllerLearning {
  controller_id: string;
  controller_name: string;
  parameter_name: string;
  learned_value: number;
  sample_count: number;
  last_updated_at: string;
}

interface GlobalParams {
  pill_compensation_damping: number;
  pill_compensation_rate_limit: number;
  pill_compensation_max_compensation: number;
  stall_rate_threshold: number;
  temp_reduction_degrees: number;
  delta_alert_threshold: number;
}

function ParamRow({ label, value, unit = "" }: { label: string; value: string | number; unit?: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{value}{unit}</span>
    </div>
  );
}

export function AiTunableParameters() {
  const [globals, setGlobals] = useState<GlobalParams | null>(null);
  const [perController, setPerController] = useState<PerControllerLearning[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [settingsRes, learningsRes, controllersRes] = await Promise.all([
        supabase
          .from("auto_cooling_settings")
          .select("pill_compensation_damping, pill_compensation_rate_limit, pill_compensation_max_compensation, stall_rate_threshold, temp_reduction_degrees, delta_alert_threshold")
          .limit(1)
          .single(),
        supabase
          .from("fermentation_learnings")
          .select("controller_id, parameter_name, learned_value, sample_count, last_updated_at")
          .or("parameter_name.eq.stall_boost_degrees,parameter_name.like.cooler_margin:%")
          .order("last_updated_at", { ascending: false }),
        supabase
          .from("rapt_temp_controllers")
          .select("controller_id, name"),
      ]);

      if (settingsRes.data) {
        setGlobals(settingsRes.data as GlobalParams);
      }

      const nameMap = new Map(controllersRes.data?.map((c) => [c.controller_id, c.name]) ?? []);

      setPerController(
        (learningsRes.data ?? []).map((l) => ({
          controller_id: l.controller_id,
          controller_name: nameMap.get(l.controller_id) ?? l.controller_id.slice(0, 8),
          parameter_name: l.parameter_name,
          learned_value: l.learned_value,
          sample_count: l.sample_count,
          last_updated_at: l.last_updated_at,
        }))
      );
    } catch (e) {
      console.error("Error loading AI tunable params:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Realtime for global settings changes
  useEffect(() => {
    const channel = supabase
      .channel("ai-tunable-settings")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "auto_cooling_settings" }, () => {
        loadData();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadData]);

  if (loading) {
    return <p className="text-[11px] text-muted-foreground">Laddar parametrar…</p>;
  }

  if (!globals) return null;

  // Group per-controller learnings
  const boostEntries = perController.filter((p) => p.parameter_name === "stall_boost_degrees");
  const marginEntries = perController.filter((p) => p.parameter_name.startsWith("cooler_margin:"));

  // Group margins by controller
  const marginsByController = marginEntries.reduce<Record<string, PerControllerLearning[]>>((acc, e) => {
    (acc[e.controller_name] ??= []).push(e);
    return acc;
  }, {});

  return (
    <div className="space-y-3 text-[11px]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Sliders className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">AI-justerbara parametrar</span>
        </div>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={loadData}>
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      {/* PID */}
      <div>
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">PID-kompensation</span>
        <div className="mt-0.5">
          <ParamRow label="Damping" value={globals.pill_compensation_damping} />
          <ParamRow label="Rate limit" value={globals.pill_compensation_rate_limit} unit="°/cykel" />
          <ParamRow label="Max komp" value={globals.pill_compensation_max_compensation} unit="°C" />
        </div>
      </div>

      {/* Stall */}
      <div>
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">Stall-detektering</span>
        <div className="mt-0.5">
          <ParamRow label="SG-tröskel" value={globals.stall_rate_threshold.toFixed(4)} unit="/h" />
          {boostEntries.map((b) => (
            <ParamRow key={b.controller_id} label={`${b.controller_name} boost`} value={b.learned_value.toFixed(1)} unit="°C" />
          ))}
        </div>
      </div>

      {/* Cooler */}
      <div>
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">Kylare</span>
        <div className="mt-0.5">
          <ParamRow label="Reduktion" value={globals.temp_reduction_degrees} unit="°C" />
          <ParamRow label="Delta-larm" value={globals.delta_alert_threshold} unit="°C" />
        </div>
      </div>

      {/* Per-controller margins */}
      {Object.keys(marginsByController).length > 0 && (
        <div>
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">Kylarmarginaler</span>
          {Object.entries(marginsByController).map(([name, items]) => (
            <div key={name} className="mt-0.5">
              <span className="text-muted-foreground font-medium">{name}</span>
              <div className="flex flex-wrap gap-x-3">
                {items
                  .sort((a, b) => a.parameter_name.localeCompare(b.parameter_name))
                  .map((item) => {
                    const bucket = item.parameter_name.replace("cooler_margin:", "").split(":")[0];
                    return (
                      <span key={item.parameter_name} className="text-muted-foreground">
                        {BUCKET_LABELS[bucket] ?? bucket}: <span className="font-mono text-foreground">{item.learned_value.toFixed(1)}°</span>
                      </span>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
