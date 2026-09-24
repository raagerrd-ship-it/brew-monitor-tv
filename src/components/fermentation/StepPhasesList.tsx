import { useEffect, useState } from "react";
import { Check, Circle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface StepPhase {
  label: string;
  status: "done" | "active" | "pending";
  detail?: string | null;
  condition?: { label: string; value: number | null; target: number | null; unit: string | null } | null;
}

// Visar exakt de delfaser Pi:n skriver i brew_status.step_phases — inget räknas fram här.
export function StepPhasesList({ brewId }: { brewId?: string }) {
  const [phases, setPhases] = useState<StepPhase[] | null>(null);

  useEffect(() => {
    if (!brewId) return;
    const load = async () => {
      const { data } = await supabase.from("brew_status").select("step_phases").eq("source_id", brewId).maybeSingle();
      setPhases(Array.isArray(data?.step_phases) ? (data!.step_phases as unknown as StepPhase[]) : null);
    };
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [brewId]);

  if (!phases?.length) return null;

  const fmt = (v: number | null) => (v == null ? "okänt" : String(Math.round(v * 10) / 10));

  return (
    <ul className="space-y-0.5 mt-1.5 text-[11px]">
      {phases.map((p, i) => (
        <li key={i} className={p.status === "active" ? "text-foreground" : "text-muted-foreground"}>
          <div className="flex items-center gap-1.5">
            {p.status === "done" ? <Check className="w-3 h-3 text-primary shrink-0" />
              : <Circle className={`w-2 h-2 shrink-0 mx-0.5 ${p.status === "active" ? "fill-primary text-primary" : ""}`} />}
            <span className={p.status === "active" ? "font-semibold" : ""}>{p.label}</span>
            {p.status === "active" && p.condition && (
              <span className="ml-auto tabular-nums text-primary">
                {fmt(p.condition.value)} / {fmt(p.condition.target)}{p.condition.unit ? ` ${p.condition.unit}` : ""}
              </span>
            )}
          </div>
          {p.status === "active" && p.detail && <div className="pl-5 text-[10px] text-muted-foreground">{p.detail}</div>}
        </li>
      ))}
    </ul>
  );
}
