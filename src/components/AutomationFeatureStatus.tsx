import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Snowflake, Wrench, AlertTriangle, Shield, Brain } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";

interface DecisionEntry {
  step: string;
  result: "pass" | "fail" | "info" | "action";
  message: string;
  details?: Record<string, unknown>;
}

interface FeatureSummary {
  icon: React.ElementType;
  label: string;
  status: string;
  variant: "action" | "idle" | "off";
}

interface Props {
  autoCoolingEnabled: boolean;
  pillCompEnabled: boolean;
  stallDetectionEnabled: boolean;
  overshootPreventionEnabled: boolean;
  aiAuditEnabled: boolean;
}

function summarizeFeatures(decisions: DecisionEntry[], props: Props): FeatureSummary[] {
  const summaries: FeatureSummary[] = [];

  // 1. Glycol cooling
  if (props.autoCoolingEnabled) {
    const glycolActions = decisions.filter(d =>
      d.step.startsWith("ADJUSTMENT") && d.result === "action"
    );
    const coolerStatus = decisions.find(d => d.step === "COOLER_STATUS" && d.result === "pass");
    const coolLearn = decisions.filter(d => d.step === "COOLING_LEARN" && d.result === "action");
    
    let status = "Ingen justering";
    if (glycolActions.length > 0) {
      // Extract temp change from message like "Setting cooler to default 14.7°C" or "Increasing cooler from X to Y"
      const lastAction = glycolActions[glycolActions.length - 1];
      status = lastAction.message.length > 50 
        ? lastAction.message.substring(0, 47) + "…" 
        : lastAction.message;
    } else if (coolLearn.length > 0) {
      status = "Lärde sig marginal";
    } else if (coolerStatus) {
      status = "Vid mål";
    }
    summaries.push({ icon: Snowflake, label: "Glykolkylare", status, variant: glycolActions.length > 0 ? "action" : "idle" });
  }

  // 2. PID / Pill compensation
  if (props.pillCompEnabled) {
    const pidActions = decisions.filter(d =>
      d.step === "PILL_COMP_ACTION" && (d.result === "action" || d.result === "pass")
    );
    const pidSkips = decisions.filter(d => d.step === "PILL_COMP_SKIP");
    
    let status = "Ingen justering";
    if (pidActions.length > 0) {
      // Extract from message like "Controller: PID 19.1°C → 19.0°C (delta=0.32, komp=..."
      const actionMsgs = pidActions.filter(d => d.result === "action");
      if (actionMsgs.length > 0) {
        const msg = actionMsgs[0].message;
        const match = msg.match(/PID\s+([\d.]+)°C\s*→\s*([\d.]+)°C.*komp=([-\d.]+)/);
        if (match) {
          status = `${match[1]}° → ${match[2]}° (${parseFloat(match[3]) >= 0 ? "+" : ""}${match[3]}°)`;
        } else {
          status = msg.length > 45 ? msg.substring(0, 42) + "…" : msg;
        }
      } else {
        status = `${pidActions.length} justering(ar)`;
      }
    } else if (pidSkips.length > 0) {
      const skipReasons = pidSkips.map(d => d.message);
      if (skipReasons.some(r => r.includes("Samma data"))) {
        status = "Ingen ny data";
      } else if (skipReasons.some(r => r.includes("cooloff"))) {
        status = "Cooloff aktiv";
      } else {
        status = "Skippade (ingen ändring)";
      }
    }
    summaries.push({ icon: Wrench, label: "PID-kompensation", status, variant: pidActions.some(d => d.result === "action") ? "action" : "idle" });
  }

  // 3. Stall detection
  if (props.stallDetectionEnabled) {
    const stallBoost = decisions.filter(d => d.step === "STALL_BOOST" && d.result === "action");
    const stallUnboost = decisions.filter(d => d.step === "STALL_UNBOOST" && d.result === "action");
    const stallCheck = decisions.filter(d => d.step.startsWith("STALL"));
    
    let status = "Ingen stall";
    if (stallBoost.length > 0) {
      const msg = stallBoost[0].message;
      const match = msg.match(/boost \+([\d.]+)°C/i);
      status = match ? `Boost +${match[1]}°C` : "Boost applicerad";
    } else if (stallUnboost.length > 0) {
      status = "Un-boost (återhämtad)";
    } else if (stallCheck.length === 0) {
      status = "Inga tankar att kontrollera";
    }
    summaries.push({ icon: AlertTriangle, label: "Stall-detektering", status, variant: stallBoost.length > 0 ? "action" : "idle" });
  }

  // 4. Overshoot prevention (runs inside PID)
  if (props.overshootPreventionEnabled) {
    const overshootEntries = decisions.filter(d => 
      d.message.toLowerCase().includes("overshoot") && d.result === "action"
    );
    const status = overshootEntries.length > 0 ? "Förebyggande åtgärd" : "Ingen overshoot";
    summaries.push({ icon: Shield, label: "Overshoot-prevention", status, variant: overshootEntries.length > 0 ? "action" : "idle" });
  }

  // 5. AI audit (separate from decision log — check ai_audit_log)
  if (props.aiAuditEnabled) {
    summaries.push({ icon: Brain, label: "AI-optimering", status: "", variant: "idle" });
  }

  return summaries;
}

export function AutomationFeatureStatus({ autoCoolingEnabled, pillCompEnabled, stallDetectionEnabled, overshootPreventionEnabled, aiAuditEnabled }: Props) {
  const [summaries, setSummaries] = useState<FeatureSummary[]>([]);
  const [logTime, setLogTime] = useState<string | null>(null);
  const [aiLastAudit, setAiLastAudit] = useState<string | null>(null);

  useEffect(() => {
    async function fetchLatest() {
      const [{ data: logData }, { data: aiData }] = await Promise.all([
        supabase
          .from("auto_cooling_decision_logs")
          .select("decisions, created_at")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        aiAuditEnabled
          ? supabase
              .from("ai_audit_log")
              .select("created_at, analysis")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      if (logData) {
        const decisions = (logData.decisions as unknown as DecisionEntry[]) || [];
        const results = summarizeFeatures(decisions, {
          autoCoolingEnabled,
          pillCompEnabled,
          stallDetectionEnabled,
          overshootPreventionEnabled,
          aiAuditEnabled,
        });

        // Enrich AI audit status
        if (aiAuditEnabled) {
          const aiEntry = results.find(r => r.label === "AI-optimering");
          if (aiEntry && aiData) {
            const ago = formatDistanceToNow(new Date(aiData.created_at), { addSuffix: true, locale: sv });
            aiEntry.status = `Senaste audit ${ago}`;
            setAiLastAudit(aiData.created_at);
          } else if (aiEntry) {
            aiEntry.status = "Ingen audit ännu";
          }
        }

        setSummaries(results);
        setLogTime(logData.created_at);
      }
    }

    fetchLatest();

    // Listen for new decision logs
    const channel = supabase
      .channel("automation-feature-status")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "auto_cooling_decision_logs" }, () => {
        fetchLatest();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "auto_cooling_decision_logs" }, () => {
        fetchLatest();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [autoCoolingEnabled, pillCompEnabled, stallDetectionEnabled, overshootPreventionEnabled, aiAuditEnabled]);

  if (summaries.length === 0) return null;

  return (
    <div className="space-y-1.5 pt-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
        Senaste cykel
        {logTime && (
          <span className="ml-1 font-normal">
            ({formatDistanceToNow(new Date(logTime), { addSuffix: true, locale: sv })})
          </span>
        )}
      </span>
      {summaries.map((s) => (
        <div key={s.label} className="flex items-center gap-2 text-xs px-1 py-0.5">
          <s.icon className={`h-3 w-3 shrink-0 ${s.variant === "action" ? "text-accent" : "text-muted-foreground/60"}`} />
          <span className="text-muted-foreground shrink-0">{s.label}</span>
          <span className={`ml-auto text-right truncate ${s.variant === "action" ? "text-accent font-medium" : "text-muted-foreground/80"}`}>
            {s.status}
          </span>
        </div>
      ))}
    </div>
  );
}
