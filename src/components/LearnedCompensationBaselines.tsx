import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Brain, Trash2, RefreshCw, Flame, Snowflake } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";

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
  low: "Låg (<1.5°)",
  medium: "Medium (1.5–3°)",
  high: "Hög (>3°)",
};

const BUCKET_COLORS: Record<string, string> = {
  low: "bg-green-500/15 text-green-400 border-green-500/30",
  medium: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  high: "bg-red-500/15 text-red-400 border-red-500/30",
};

const STEP_TYPE_LABELS: Record<string, string> = {
  hold: "Håll",
  ramp: "Rampa",
  wait_for_gravity_stable: "SG-stabil",
  wait_for_sg: "SG-mål",
  wait_for_temp: "Temp-mål",
  wait_for_acknowledgement: "Torrhumla",
  standalone: "Fristående",
  unknown: "Okänd",
};

const MODE_ICONS: Record<string, { icon: typeof Flame; label: string; className: string }> = {
  heating: { icon: Flame, label: "Värme", className: "text-orange-400" },
  cooling: { icon: Snowflake, label: "Kyla", className: "text-blue-400" },
};

export function LearnedCompensationBaselines() {
  const { toast } = useToast();
  const [entries, setEntries] = useState<LearnedEntry[]>([]);
  const [loading, setLoading] = useState(true);

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

  // Group by controller
  const grouped = entries.reduce<Record<string, LearnedEntry[]>>((acc, e) => {
    (acc[e.controller_name] ??= []).push(e);
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Inlärda baselines</span>
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
                  Nollställ alla
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Nollställ alla baselines?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Alla inlärda baselines för samtliga kontrollrar tas bort. Systemet börjar om från noll och måste lära sig kompensationen på nytt.
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
        <div key={name} className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2">
          <span className="text-xs font-medium">{name}</span>
          <div className="space-y-2">
            {items.map((item) => {
              const modeInfo = MODE_ICONS[item.mode] ?? MODE_ICONS.cooling;
              const ModeIcon = modeInfo.icon;
              const hasLivePid = item.latest_p_correction !== 0 || item.latest_i_correction !== 0 || item.latest_avg_error !== 0;

              return (
                <div key={item.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <ModeIcon className={`h-3 w-3 shrink-0 ${modeInfo.className}`} />
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${BUCKET_COLORS[item.delta_bucket] ?? ""}`}>
                        {BUCKET_LABELS[item.delta_bucket] ?? item.delta_bucket}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-muted/30">
                        {STEP_TYPE_LABELS[item.step_type] ?? item.step_type}
                      </Badge>
                      <span className="text-xs font-mono font-semibold">
                        {item.learned_pi_correction >= 0 ? "+" : ""}{item.learned_pi_correction.toFixed(2)}°C
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        ({item.convergence_count} konv.
                        {item.last_converged_at && (
                          <>, {formatDistanceToNow(new Date(item.last_converged_at), { locale: sv, addSuffix: true })}</>
                        )}
                        )
                      </span>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive shrink-0"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Nollställ baseline?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Baseline "{BUCKET_LABELS[item.delta_bucket] ?? item.delta_bucket}" ({modeInfo.label}) för {name} tas bort permanent.
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
                  </div>
                  {hasLivePid && (
                    <div className="ml-5 flex items-center gap-3 text-[10px] text-muted-foreground font-mono">
                      <span>P={item.latest_p_correction >= 0 ? "+" : ""}{item.latest_p_correction.toFixed(2)}</span>
                      <span>I={item.latest_i_correction >= 0 ? "+" : ""}{item.latest_i_correction.toFixed(3)}</span>
                      <span>D={item.latest_d_damping.toFixed(2)}</span>
                      <span className="text-muted-foreground/60">err={item.latest_avg_error >= 0 ? "+" : ""}{item.latest_avg_error.toFixed(2)}°</span>
                      <span className="text-muted-foreground/40">∫={item.accumulated_integral >= 0 ? "+" : ""}{item.accumulated_integral.toFixed(3)}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
