import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sliders, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

const BUCKET_LABELS: Record<string, string> = {
  cold: "Kall",
  cool: "Sval",
  warm: "Varm",
  hot: "Het",
};

// Bounds matching ai-automation-audit/index.ts
const BOUNDS: Record<string, [number, number]> = {
  pill_compensation_damping: [0.1, 0.9],
  pill_compensation_rate_limit: [0.1, 1.0],
  pill_compensation_max_compensation: [1.0, 8.0],
  pill_compensation_min_scale: [0.05, 0.5],
  pill_compensation_emergency_threshold: [1.0, 5.0],
  overshoot_pill_threshold: [0.1, 1.0],
  overshoot_delta_threshold: [0.5, 5.0],
  stall_rate_threshold: [0.0005, 0.005],
  auto_boost_degrees: [0.5, 4.0],
  stall_min_attenuation: [5, 30],
  stall_max_attenuation: [70, 95],
  temp_reduction_degrees: [1.0, 10.0],
  max_diff_from_lowest: [3.0, 15.0],
  delta_alert_threshold: [0.5, 5.0],
  smart_relay_min_hysteresis: [0.1, 1.0],
  smart_relay_cooling_only_below: [0, 10],
  smart_relay_heating_only_above: [0, 10],
  smart_relay_tighten_after_minutes: [5, 60],
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
  pill_compensation_min_scale: number;
  pill_compensation_emergency_threshold: number;
  overshoot_pill_threshold: number;
  overshoot_delta_threshold: number;
  stall_rate_threshold: number;
  auto_boost_degrees: number;
  stall_min_attenuation: number;
  stall_max_attenuation: number;
  temp_reduction_degrees: number;
  delta_alert_threshold: number;
  max_diff_from_lowest: number;
  smart_relay_min_hysteresis: number;
  smart_relay_cooling_only_below: number;
  smart_relay_heating_only_above: number;
  smart_relay_tighten_after_minutes: number;
}

function ParamRow({ label, value, unit = "", boundsKey }: { label: string; value: string | number; unit?: string; boundsKey?: string }) {
  const bounds = boundsKey ? BOUNDS[boundsKey] : undefined;
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        {bounds && (
          <span className="text-[9px] text-muted-foreground/50 font-mono">{bounds[0]}–{bounds[1]}</span>
        )}
        <span className="font-mono text-foreground">{value}{unit}</span>
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">{children}</span>;
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
          .select("pill_compensation_damping, pill_compensation_rate_limit, pill_compensation_max_compensation, pill_compensation_min_scale, pill_compensation_emergency_threshold, overshoot_pill_threshold, overshoot_delta_threshold, stall_rate_threshold, auto_boost_degrees, stall_min_attenuation, stall_max_attenuation, temp_reduction_degrees, delta_alert_threshold, max_diff_from_lowest, smart_relay_min_hysteresis, smart_relay_cooling_only_below, smart_relay_heating_only_above, smart_relay_tighten_after_minutes")
          .limit(1)
          .single(),
        supabase
          .from("fermentation_learnings")
          .select("controller_id, parameter_name, learned_value, sample_count, last_updated_at")
          .or("parameter_name.eq.stall_boost_degrees,parameter_name.like.cooler_margin:%,parameter_name.like.hold_margin:%,parameter_name.like.ramp_margin:%,parameter_name.like.duty_cycle:%,parameter_name.like.cooling_rate:%,parameter_name.like.warming_rate:%")
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

  const boostEntries = perController.filter((p) => p.parameter_name === "stall_boost_degrees");
  const marginEntries = perController.filter((p) => p.parameter_name.startsWith("cooler_margin:"));
  const holdMarginEntries = perController.filter((p) => p.parameter_name.startsWith("hold_margin:"));
  const rampMarginEntries = perController.filter((p) => p.parameter_name.startsWith("ramp_margin:"));
  const dutyCycleEntries = perController.filter((p) => p.parameter_name.startsWith("duty_cycle:"));
  const coolingRateEntries = perController.filter((p) => p.parameter_name.startsWith("cooling_rate:"));
  const warmingRateEntries = perController.filter((p) => p.parameter_name.startsWith("warming_rate:"));

  const marginsByController = marginEntries.reduce<Record<string, PerControllerLearning[]>>((acc, e) => {
    (acc[e.controller_name] ??= []).push(e);
    return acc;
  }, {});

  const groupByController = (entries: PerControllerLearning[]) =>
    entries.reduce<Record<string, PerControllerLearning[]>>((acc, e) => {
      (acc[e.controller_name] ??= []).push(e);
      return acc;
    }, {});

  const holdByController = groupByController(holdMarginEntries);
  const rampByController = groupByController(rampMarginEntries);
  const dutyByController = groupByController(dutyCycleEntries);
  const rateByController = groupByController(coolingRateEntries);

  function renderBucketValues(items: PerControllerLearning[], extractKey: (name: string) => string, unit = "°", boundsRange?: [number, number]) {
    return (
      <div className="flex flex-wrap gap-x-3">
        {items
          .sort((a, b) => a.parameter_name.localeCompare(b.parameter_name))
          .map((item) => {
            const key = extractKey(item.parameter_name);
            return (
              <span key={item.parameter_name} className="text-muted-foreground">
                {BUCKET_LABELS[key] ?? key}: <span className="font-mono text-foreground">{item.learned_value.toFixed(1)}{unit}</span>
              </span>
            );
          })}
        {boundsRange && (
          <span className="text-[9px] text-muted-foreground/50 font-mono ml-auto">{boundsRange[0]}–{boundsRange[1]}</span>
        )}
      </div>
    );
  }

  function renderGroupedSection(grouped: Record<string, PerControllerLearning[]>, extractKey: (name: string) => string, unit = "°", boundsRange?: [number, number]) {
    if (Object.keys(grouped).length === 0) return null;
    return Object.entries(grouped).map(([name, items]) => (
      <div key={name} className="mt-0.5">
        <span className="text-muted-foreground font-medium">{name}</span>
        {renderBucketValues(items, extractKey, unit, boundsRange)}
      </div>
    ));
  }

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
        <SectionHeader>PID-kompensation</SectionHeader>
        <div className="mt-0.5">
          <ParamRow label="Damping" value={globals.pill_compensation_damping} boundsKey="pill_compensation_damping" />
          <ParamRow label="Rate limit" value={globals.pill_compensation_rate_limit} unit="°/cykel" boundsKey="pill_compensation_rate_limit" />
          <ParamRow label="Max komp" value={globals.pill_compensation_max_compensation} unit="°C" boundsKey="pill_compensation_max_compensation" />
          <ParamRow label="Min scale" value={globals.pill_compensation_min_scale} boundsKey="pill_compensation_min_scale" />
          <ParamRow label="Nödläge" value={globals.pill_compensation_emergency_threshold} unit="°C" boundsKey="pill_compensation_emergency_threshold" />
        </div>
      </div>

      {/* Overshoot */}
      <div>
        <SectionHeader>Overshoot-skydd</SectionHeader>
        <div className="mt-0.5">
          <ParamRow label="Pill-tröskel" value={globals.overshoot_pill_threshold} unit="°C" boundsKey="overshoot_pill_threshold" />
          <ParamRow label="Delta-tröskel" value={globals.overshoot_delta_threshold} unit="°C" boundsKey="overshoot_delta_threshold" />
        </div>
      </div>

      {/* Stall */}
      <div>
        <SectionHeader>Stall-detektering</SectionHeader>
        <div className="mt-0.5">
          <ParamRow label="SG-tröskel" value={globals.stall_rate_threshold.toFixed(4)} unit="/h" boundsKey="stall_rate_threshold" />
          <ParamRow label="Boost" value={globals.auto_boost_degrees} unit="°C" boundsKey="auto_boost_degrees" />
          <ParamRow label="Min dämpning" value={globals.stall_min_attenuation} unit="%" boundsKey="stall_min_attenuation" />
          <ParamRow label="Max dämpning" value={globals.stall_max_attenuation} unit="%" boundsKey="stall_max_attenuation" />
          {boostEntries.map((b) => (
            <ParamRow key={b.controller_id} label={`${b.controller_name} boost`} value={b.learned_value.toFixed(1)} unit="°C" />
          ))}
        </div>
      </div>

      {/* Cooler */}
      <div>
        <SectionHeader>Kylare</SectionHeader>
        <div className="mt-0.5">
          <ParamRow label="Reduktion" value={globals.temp_reduction_degrees} unit="°C" boundsKey="temp_reduction_degrees" />
          <ParamRow label="Max diff" value={globals.max_diff_from_lowest} unit="°C" boundsKey="max_diff_from_lowest" />
          <ParamRow label="Delta-larm" value={globals.delta_alert_threshold} unit="°C" boundsKey="delta_alert_threshold" />
        </div>
      </div>

      {/* Per-controller cooler margins */}
      {Object.keys(marginsByController).length > 0 && (
        <div>
          <SectionHeader>Kylarmarginaler <span className="font-mono text-[9px] text-muted-foreground/50 normal-case">0.5–8.0</span></SectionHeader>
          {Object.entries(marginsByController).map(([name, items]) => (
            <div key={name} className="mt-0.5">
              <span className="text-muted-foreground font-medium">{name}</span>
              {renderBucketValues(items, (n) => n.replace("cooler_margin:", "").split(":")[0])}
            </div>
          ))}
        </div>
      )}

      {/* Hold margins */}
      {Object.keys(holdByController).length > 0 && (
        <div>
          <SectionHeader>Hold-marginaler <span className="font-mono text-[9px] text-muted-foreground/50 normal-case">0.5–8.0</span></SectionHeader>
          {renderGroupedSection(holdByController, (n) => n.replace("hold_margin:", "").split(":")[0])}
        </div>
      )}

      {/* Ramp margins */}
      {Object.keys(rampByController).length > 0 && (
        <div>
          <SectionHeader>Ramp-marginaler <span className="font-mono text-[9px] text-muted-foreground/50 normal-case">0.5–8.0</span></SectionHeader>
          {renderGroupedSection(rampByController, (n) => n.replace("ramp_margin:", "").split(":")[0])}
        </div>
      )}

      {/* Duty cycles */}
      {Object.keys(dutyByController).length > 0 && (
        <div>
          <SectionHeader>Duty cycle <span className="font-mono text-[9px] text-muted-foreground/50 normal-case">5–95</span></SectionHeader>
          {renderGroupedSection(dutyByController, (n) => n.replace("duty_cycle:", ""), "%")}
        </div>
      )}

      {/* Cooling rates */}
      {Object.keys(rateByController).length > 0 && (
        <div>
          <SectionHeader>Kylhastighet <span className="font-mono text-[9px] text-muted-foreground/50 normal-case">0.01–2.0</span></SectionHeader>
          {renderGroupedSection(rateByController, (n) => n.replace("cooling_rate:", "").split(":")[0], "°/min")}
        </div>
      )}
    </div>
  );
}
