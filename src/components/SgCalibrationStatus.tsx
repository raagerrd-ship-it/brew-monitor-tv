import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Thermometer, Target, Hash } from "lucide-react";

interface CalibrationRow {
  pill_id: string;
  anchor_sg: number | null;
  anchor_temp: number | null;
  status: string;
  updated_at: string;
}

interface LearningRow {
  controller_id: string;
  parameter_name: string;
  learned_value: number;
  sample_count: number;
}

export function SgCalibrationStatus() {
  const { data: calibrations } = useQuery({
    queryKey: ["pill-sg-calibration"],
    queryFn: async () => {
      const { data } = await supabase
        .from("pill_sg_calibration" as any)
        .select("pill_id, anchor_sg, anchor_temp, status, updated_at") as any;
      return (data || []) as CalibrationRow[];
    },
    refetchInterval: 60000,
  });

  const { data: learnings } = useQuery({
    queryKey: ["sg-residual-learnings"],
    queryFn: async () => {
      const { data } = await supabase
        .from("fermentation_learnings")
        .select("controller_id, parameter_name, learned_value, sample_count")
        .like("parameter_name", "sg_residual_per_degree:%");
      return (data || []) as LearningRow[];
    },
    refetchInterval: 60000,
  });

  const { data: pills } = useQuery({
    queryKey: ["rapt-pills-names"],
    queryFn: async () => {
      const { data } = await supabase.from("rapt_pills").select("pill_id, name");
      return data || [];
    },
  });

  const pillNameMap = new Map(pills?.map(p => [p.pill_id, p.name]) || []);
  const learningMap = new Map(
    learnings?.map(l => {
      const pillId = l.parameter_name.replace("sg_residual_per_degree:", "");
      return [pillId, l];
    }) || []
  );

  // Merge calibrations with learnings — show all pills that have either
  const allPillIds = new Set([
    ...(calibrations?.map(c => c.pill_id) || []),
    ...(learnings?.map(l => l.parameter_name.replace("sg_residual_per_degree:", "")) || []),
  ]);

  if (allPillIds.size === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Ingen SG-kalibrering ännu. Ankare sätts automatiskt vid cold crash.
      </p>
    );
  }

  const statusLabel: Record<string, string> = {
    idle: "Väntar",
    anchored: "Ankare satt",
    learning: "Lär sig",
    calibrated: "Kalibrerad",
  };

  const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
    idle: "outline",
    anchored: "secondary",
    learning: "default",
    calibrated: "default",
  };

  return (
    <div className="space-y-3">
      {[...allPillIds].map(pillId => {
        const cal = calibrations?.find(c => c.pill_id === pillId);
        const learning = learningMap.get(pillId);
        const name = pillNameMap.get(pillId) || pillId.slice(0, 8);
        const status = cal?.status || "idle";

        return (
          <div key={pillId} className="flex flex-col gap-1.5 p-3 rounded-lg bg-muted/30 border border-border/50">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{name}</span>
              <Badge variant={statusVariant[status] || "outline"}>
                {statusLabel[status] || status}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {cal?.anchor_sg && (
                <span className="flex items-center gap-1">
                  <Target className="h-3 w-3" />
                  Ankare: {Number(cal.anchor_sg).toFixed(4)} @ {Number(cal.anchor_temp).toFixed(1)}°C
                </span>
              )}
              {learning && (
                <>
                  <span className="flex items-center gap-1">
                    <Thermometer className="h-3 w-3" />
                    Residual: {Number(learning.learned_value).toFixed(6)}/°C
                  </span>
                  <span className="flex items-center gap-1">
                    <Hash className="h-3 w-3" />
                    {learning.sample_count} sample{learning.sample_count !== 1 ? "s" : ""}
                  </span>
                </>
              )}
              {!cal?.anchor_sg && !learning && (
                <span>Väntar på stabil jäsning + cold crash</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
