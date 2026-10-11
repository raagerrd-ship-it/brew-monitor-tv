import { useEffect, useState } from "react";
import { Check, Circle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export interface StepPhase {
  label: string;
  status: "done" | "active" | "pending";
  detail?: string | null;
  condition?: { label: string; value: number | null; target: number | null; unit: string | null; remaining_h?: number | null; ends_at?: string | null } | null;
}

const fmt = (v: number | null) => (v == null ? "okänt" : String(Math.round(v * 10) / 10));
export const formatCondition = (c: NonNullable<StepPhase["condition"]>) =>
  `${fmt(c.value)} / ${fmt(c.target)}${c.unit ? ` ${c.unit}` : ""}`;

export interface StepStatus {
  phases: StepPhase[] | null;
  stepName: string | null;
  stepCount: number | null;
  stepIndex: number | null;
  stepEndsAt: string | null;
  tempTargetC: number | null;
}

// Läser exakt det Pi:n skriver i brew_status — inget räknas fram här.
export function useStepPhases(brewId?: string): StepStatus | null {
  const [status, setStatus] = useState<StepStatus | null>(null);
  useEffect(() => {
    if (!brewId) return;
    const load = async () => {
      const { data } = await supabase
        .from("brew_status")
        .select("step_phases, step_name, step_count, step_index, step_ends_at, temp_target_c")
        .or(`source_id.eq.${brewId},pi_brew_id.eq.${brewId}`)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const next: StepStatus = {
        phases: Array.isArray(data?.step_phases) ? (data!.step_phases as unknown as StepPhase[]) : null,
        stepName: data?.step_name ?? null,
        stepCount: data?.step_count ?? null,
        stepIndex: data?.step_index ?? null,
        stepEndsAt: data?.step_ends_at ?? null,
        tempTargetC: data?.temp_target_c ?? null,
      };
      setStatus((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [brewId]);
  return status;
}

export function StepPhasesList({ phases }: { phases: StepPhase[] | null }) {
  if (!phases?.length) return null;
  return (
    <ul className="space-y-0.5 mt-1.5 text-[11px]">
      {phases.map((p, i) => (
        <li key={i} className={p.status === "active" ? "text-foreground" : "text-muted-foreground"}>
          <div className="flex items-center gap-1.5">
            {p.status === "done" ? <Check className="w-3 h-3 text-primary shrink-0" />
              : <Circle className={`w-2 h-2 shrink-0 mx-0.5 ${p.status === "active" ? "fill-primary text-primary" : ""}`} />}
            <span className={p.status === "active" ? "font-semibold" : ""}>{p.label}</span>
            {p.status === "active" && p.condition && (
              <span className="ml-auto tabular-nums text-primary">{formatCondition(p.condition)}</span>
            )}
          </div>
          {p.status === "active" && p.detail && <div className="pl-5 text-[10px] text-muted-foreground">{p.detail}</div>}
        </li>
      ))}
    </ul>
  );
}
