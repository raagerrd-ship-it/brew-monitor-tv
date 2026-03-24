import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Brain, Trash2, RefreshCw, Flame, Snowflake, ChevronDown, ChevronRight } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks";
import { formatRecency } from "@/lib/format-recency";

interface LearnedEntry {
  id: string;
  controller_id: string;
  delta_bucket: string;
  mode: string;
  step_type: string;
  learned_pi_correction: number;
  convergence_count: number;
  last_converged_at: string | null;
  latest_p_correction: number;
  latest_i_correction: number;
  latest_d_damping: number;
  latest_avg_error: number;
  accumulated_integral: number;
  controller_name: string;
}

const BUCKET_LABELS: Record<string, string> = {
  low: "Låg",
  medium: "Med",
  high: "Hög",
};

const BUCKET_COLORS: Record<string, string> = {
  low: "bg-green-500/15 text-green-400 border-green-500/30",
  medium: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  high: "bg-red-500/15 text-red-400 border-red-500/30",
};

const STEP_TYPE_LABELS: Record<string, string> = {
  hold: "Håll",
  ramp: "Ramp",
  wait_for_gravity_stable: "SG-stab",
  wait_for_sg: "SG-mål",
  wait_for_temp: "T-mål",
  wait_for_acknowledgement: "Vänta",
  standalone: "Fri",
  unknown: "–",
  profile: "Profil",
};

export function LearnedCompensationBaselines() {
  const { toast } = useToast();
  const [entries, setEntries] = useState<LearnedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const loadData = useCallback(async () => {
    try {
      const { data: learned } = await supabase
        .from("controller_learned_compensation")
        .select("id, controller_id, delta_bucket, mode, step_type, learned_pi_correction, convergence_count, last_converged_at, latest_p_correction, latest_i_correction, latest_d_damping, latest_avg_error, accumulated_integral")
        .order("controller_id")
        .order("mode")
        .order("step_type")
        .order("delta_bucket");

      if (!learned || learned.length === 0) {
        setEntries([]);
        setLoading(false);
        return;
      }

      const controllerIds = [...new Set(learned.map((l) => l.controller_id))];
      const { data: controllers } = await supabase
        .from("rapt_temp_controllers")
        .select("controller_id, name")
        .in("controller_id", controllerIds);

      const nameMap = new Map(controllers?.map((c) => [c.controller_id, c.name]) ?? []);

      setEntries(
        learned.map((l) => ({
          ...l,
          controller_name: nameMap.get(l.controller_id) ?? l.controller_id.slice(0, 8),
        }))
      );
    } catch (e) {
      console.error("Error loading learned compensation:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleReset = async (id: string) => {
    try {
      const { error } = await supabase
        .from("controller_learned_compensation")
        .delete()
        .eq("id", id);

      if (error) throw error;
      setEntries((prev) => prev.filter((e) => e.id !== id));
      toast({ title: "Nollställd", description: "Inlärd baseline borttagen" });
    } catch (e) {
      console.error("Error deleting learned compensation:", e);
      toast({ title: "Fel", description: "Kunde inte nollställa", variant: "destructive" });
    }
  };

  const handleResetAll = async () => {
    try {
      const { error } = await supabase
        .from("controller_learned_compensation")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");

      if (error) throw error;
      setEntries([]);
      toast({ title: "Nollställda", description: "Alla inlärda baselines borttagna" });
    } catch (e) {
      console.error("Error deleting all learned compensation:", e);
      toast({ title: "Fel", description: "Kunde inte nollställa", variant: "destructive" });
    }
  };

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return <p className="text-xs text-muted-foreground">Laddar inlärda värden…</p>;
  }

  if (entries.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Brain className="h-3.5 w-3.5" />
        <span>Inga inlärda baselines ännu. Systemet lär sig automatiskt under drift.</span>
      </div>
    );
  }

  const grouped = entries.reduce<Record<string, LearnedEntry[]>>((acc, e) => {
    (acc[e.controller_name] ??= []).push(e);
    return acc;
  }, {});

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">PID-baselines</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={loadData}>
            <RefreshCw className="h-3 w-3" />
          </Button>
          {entries.length > 1 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:text-destructive">
                  <Trash2 className="h-3 w-3 mr-1" />
                  Nollställ
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Nollställ alla baselines?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Alla inlärda baselines för samtliga kontrollrar tas bort. Systemet börjar om från noll.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Avbryt</AlertDialogCancel>
                  <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleResetAll}>
                    Ja, nollställ alla
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {Object.entries(grouped).map(([name, items]) => (
        <div key={name} className="space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">{name}</span>
          <table className="w-full text-xs table-fixed">
            <thead>
              <tr className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
                <th className="text-left font-medium pb-1 w-[14%]"></th>
                <th className="text-left font-medium pb-1 w-[18%]">Delta</th>
                <th className="text-left font-medium pb-1 w-[16%]">Steg</th>
                <th className="text-right font-medium pb-1 w-[20%]">Duty/Korr</th>
                <th className="text-right font-medium pb-1 w-[18%]">Konv.</th>
                <th className="text-right font-medium pb-1 w-[14%]"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {items.map((item) => {
                const isHeating = item.mode === "heating";
                const ModeIcon = isHeating ? Flame : Snowflake;
                const modeColor = isHeating ? "text-orange-400" : "text-blue-400";
                const corrColor = isHeating ? "text-orange-400" : "text-cyan-400";
                const isExpanded = expandedRows.has(item.id);
                const hasDetails = item.latest_p_correction !== 0 || item.latest_i_correction !== 0 || item.latest_avg_error !== 0;

                return (
                  <tr
                    key={item.id}
                    className={hasDetails ? "cursor-pointer hover:bg-muted/30" : ""}
                    onClick={() => hasDetails && toggleRow(item.id)}
                  >
                    <td className="py-1.5">
                      <div className="flex items-center gap-1">
                        {hasDetails && (
                          isExpanded
                            ? <ChevronDown className="h-2.5 w-2.5 text-muted-foreground/50" />
                            : <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/50" />
                        )}
                        <ModeIcon className={`h-3 w-3 ${modeColor}`} />
                      </div>
                    </td>
                    <td className="py-1.5">
                      <Badge variant="outline" className={`text-[9px] px-1 py-0 leading-tight ${BUCKET_COLORS[item.delta_bucket] ?? ""}`}>
                        {BUCKET_LABELS[item.delta_bucket] ?? item.delta_bucket}
                      </Badge>
                    </td>
                    <td className="py-1.5 text-muted-foreground">
                      {STEP_TYPE_LABELS[item.step_type] ?? item.step_type}
                    </td>
                    <td className={`py-1.5 text-right font-mono ${corrColor}`}>
                      {!isHeating
                        ? `${Math.round(item.accumulated_integral * 100)}%`
                        : `${item.learned_pi_correction >= 0 ? "+" : ""}${item.learned_pi_correction.toFixed(2)}°`
                      }
                    </td>
                    <td className="py-1.5 text-right text-muted-foreground">
                      <span>{item.convergence_count}</span>
                      {item.last_converged_at && (
                        <span className="text-muted-foreground/60 ml-1">
                          {formatRecency(item.last_converged_at)}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0 text-muted-foreground/40 hover:text-destructive"
                          >
                            <Trash2 className="h-2.5 w-2.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Nollställ baseline?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Baseline "{BUCKET_LABELS[item.delta_bucket] ?? item.delta_bucket}" ({isHeating ? "värme" : "kyla"}) för {name} tas bort permanent.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Avbryt</AlertDialogCancel>
                            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => handleReset(item.id)}>
                              Nollställ
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* Expanded PID details rendered outside table for proper layout */}
          {items.map((item) => {
            const isExpanded = expandedRows.has(item.id);
            const hasDetails = item.latest_p_correction !== 0 || item.latest_i_correction !== 0 || item.latest_avg_error !== 0;
            const isItemHeating = item.mode === "heating";
            if (!isExpanded || !hasDetails) return null;
            return (
              <div key={`detail-${item.id}`} className="ml-4 mb-1 flex items-center gap-3 text-[10px] text-muted-foreground/70 font-mono bg-muted/10 rounded px-2 py-1">
                {isItemHeating ? (
                  <>
                    <span>P={item.latest_p_correction >= 0 ? "+" : ""}{item.latest_p_correction.toFixed(2)}</span>
                    <span>I={item.latest_i_correction >= 0 ? "+" : ""}{item.latest_i_correction.toFixed(3)}</span>
                    <span>D={item.latest_d_damping.toFixed(2)}</span>
                    <span>err={item.latest_avg_error >= 0 ? "+" : ""}{item.latest_avg_error.toFixed(2)}°</span>
                    <span className="text-muted-foreground/40">∫={item.accumulated_integral >= 0 ? "+" : ""}{item.accumulated_integral.toFixed(3)}</span>
                  </>
                ) : (
                  <>
                    <span>P={Math.round(item.latest_p_correction * 100)}%</span>
                    <span>I={Math.round(item.latest_i_correction * 100)}%</span>
                    <span>D={item.latest_d_damping.toFixed(2)}</span>
                    <span>err={item.latest_avg_error >= 0 ? "+" : ""}{item.latest_avg_error.toFixed(2)}°</span>
                    <span className="text-muted-foreground/40">duty={Math.round(item.accumulated_integral * 100)}%</span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
