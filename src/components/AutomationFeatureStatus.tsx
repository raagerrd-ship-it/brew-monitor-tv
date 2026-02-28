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

interface ControllerLine {
  name: string;
  status: string;
  variant: "action" | "idle" | "skip";
}

interface FeatureBlock {
  icon: React.ElementType;
  label: string;
  controllers: ControllerLine[];
  hasAction: boolean;
}

interface Props {
  autoCoolingEnabled: boolean;
  pillCompEnabled: boolean;
  stallDetectionEnabled: boolean;
  overshootPreventionEnabled: boolean;
  aiAuditEnabled: boolean;
}

/** Extract controller name from start of message like "Temp Controller X: ..." */
function extractName(msg: string): string {
  const colonIdx = msg.indexOf(":");
  if (colonIdx > 0 && colonIdx < 50) return msg.substring(0, colonIdx).trim();
  return msg;
}

function buildFeatureBlocks(decisions: DecisionEntry[], props: Props): FeatureBlock[] {
  const blocks: FeatureBlock[] = [];

  // Collect all followed controller names from FOLLOWED_DATA
  const followedNames = decisions
    .filter(d => d.step === "FOLLOWED_DATA")
    .map(d => {
      const match = d.message.match(/^Controller:\s*(.+)$/);
      return match ? match[1].trim() : null;
    })
    .filter(Boolean) as string[];

  // 1. Glycol cooling
  if (props.autoCoolingEnabled) {
    const glycolActions = decisions.filter(d => d.step === "ADJUSTMENT" && d.result === "action");
    const coolerStatus = decisions.find(d => d.step === "COOLER_STATUS" && d.result === "pass");
    const coolerName = coolerStatus?.details?.name as string
      ?? (coolerStatus ? extractName(coolerStatus.message.replace("Cooler: ", "")) : "Kylare");

    const controllers: ControllerLine[] = [];
    if (glycolActions.length > 0) {
      const last = glycolActions[glycolActions.length - 1];
      const match = last.message.match(/([\d.]+)°C.*?([\d.]+)°C/);
      controllers.push({
        name: coolerName,
        status: match ? `${match[1]}° → ${match[2]}°` : last.message.substring(0, 40),
        variant: "action",
      });
    } else {
      controllers.push({ name: coolerName, status: "Vid mål", variant: "idle" });
    }

    // Show followed controllers' demand
    for (const name of followedNames) {
      const data = decisions.find(d => d.step === "FOLLOWED_DATA" && d.message.includes(name));
      if (data?.details) {
        const target = data.details.target_temp as number | undefined;
        const profileTarget = data.details.profile_target_temp as number | undefined;
        const cooling = data.details.cooling_enabled as boolean | undefined;
        if (!cooling) {
          controllers.push({ name, status: "Kylning av", variant: "skip" });
        } else {
          const t = target != null ? `${Number(target).toFixed(1)}°` : "—";
          const pt = profileTarget != null ? `mål ${Number(profileTarget).toFixed(1)}°` : "";
          controllers.push({ name, status: `${t}${pt ? ` (${pt})` : ""}`, variant: "idle" });
        }
      }
    }

    blocks.push({ icon: Snowflake, label: "Glykolkylare", controllers, hasAction: glycolActions.length > 0 });
  }

  // 2. PID / Pill compensation
  if (props.pillCompEnabled) {
    const controllers: ControllerLine[] = [];

    for (const name of followedNames) {
      // Check for action
      const action = decisions.find(d =>
        d.step === "PILL_COMP_ACTION" && d.result === "action" && d.message.startsWith(name)
      );
      const skip = decisions.find(d =>
        d.step === "PILL_COMP_SKIP" && d.message.startsWith(name)
      );
      const noSession = decisions.find(d =>
        d.step === "PILL_COMP_SKIP" && d.message.includes(name) && d.message.includes("profile-owned but no profile_target_temp")
      );

      if (action) {
        const match = action.message.match(/PID\s+([\d.]+)°C\s*→\s*([\d.]+)°C.*komp=([-\d.]+)/);
        if (match) {
          const komp = parseFloat(match[3]);
          controllers.push({
            name,
            status: `${match[1]}° → ${match[2]}° (${komp >= 0 ? "+" : ""}${match[3]}°)`,
            variant: "action",
          });
        } else {
          controllers.push({ name, status: "Justerad", variant: "action" });
        }
      } else if (noSession) {
        controllers.push({ name, status: "Ingen profil", variant: "skip" });
      } else if (skip) {
        if (skip.message.includes("Samma data")) {
          controllers.push({ name, status: "Ingen ny data", variant: "idle" });
        } else if (skip.message.includes("cooloff")) {
          controllers.push({ name, status: "Cooloff aktiv", variant: "skip" });
        } else if (skip.message.includes("no active session")) {
          controllers.push({ name, status: "Ingen session", variant: "skip" });
        } else {
          controllers.push({ name, status: "Skippade", variant: "idle" });
        }
      } else {
        // Check if controller has no session at all
        const hasSessionData = decisions.find(d =>
          d.step === "PILL_COMP" && d.message.includes(name)
        );
        controllers.push({ name, status: hasSessionData ? "Ingen ändring" : "Ej aktiv", variant: "skip" });
      }
    }

    blocks.push({
      icon: Wrench,
      label: "PID-kompensation",
      controllers,
      hasAction: controllers.some(c => c.variant === "action"),
    });
  }

  // 3. Stall detection
  if (props.stallDetectionEnabled) {
    const controllers: ControllerLine[] = [];

    for (const name of followedNames) {
      const boost = decisions.find(d =>
        d.step === "STALL_BOOST" && d.result === "action" && d.message.startsWith(name)
      );
      const unboost = decisions.find(d =>
        d.step === "STALL_UNBOOST" && d.result === "action" && d.message.startsWith(name)
      );
      const stallCheck = decisions.find(d =>
        d.step.startsWith("STALL") && d.message.includes(name)
      );

      if (boost) {
        const match = boost.message.match(/boost \+([\d.]+)°C/i);
        controllers.push({ name, status: match ? `Boost +${match[1]}°` : "Boost", variant: "action" });
      } else if (unboost) {
        controllers.push({ name, status: "Un-boost (återhämtad)", variant: "action" });
      } else if (stallCheck) {
        controllers.push({ name, status: "Ingen stall", variant: "idle" });
      } else {
        controllers.push({ name, status: "Ej kontrollerad", variant: "skip" });
      }
    }

    blocks.push({
      icon: AlertTriangle,
      label: "Stall-detektering",
      controllers,
      hasAction: controllers.some(c => c.variant === "action"),
    });
  }

  // 4. Overshoot prevention
  if (props.overshootPreventionEnabled) {
    const controllers: ControllerLine[] = [];

    for (const name of followedNames) {
      const overshoot = decisions.find(d =>
        d.message.toLowerCase().includes("overshoot") && d.result === "action" && d.message.includes(name)
      );
      controllers.push({
        name,
        status: overshoot ? "Förebyggande åtgärd" : "OK",
        variant: overshoot ? "action" : "idle",
      });
    }

    blocks.push({
      icon: Shield,
      label: "Overshoot-prevention",
      controllers,
      hasAction: controllers.some(c => c.variant === "action"),
    });
  }

  // 5. AI audit
  if (props.aiAuditEnabled) {
    blocks.push({ icon: Brain, label: "AI-optimering", controllers: [], hasAction: false });
  }

  return blocks;
}

export function AutomationFeatureStatus({ autoCoolingEnabled, pillCompEnabled, stallDetectionEnabled, overshootPreventionEnabled, aiAuditEnabled }: Props) {
  const [blocks, setBlocks] = useState<FeatureBlock[]>([]);
  const [logTime, setLogTime] = useState<string | null>(null);

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
              .select("created_at")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      if (logData) {
        const decisions = (logData.decisions as unknown as DecisionEntry[]) || [];
        const results = buildFeatureBlocks(decisions, {
          autoCoolingEnabled, pillCompEnabled, stallDetectionEnabled, overshootPreventionEnabled, aiAuditEnabled,
        });

        // Enrich AI
        if (aiAuditEnabled) {
          const aiBlock = results.find(r => r.label === "AI-optimering");
          if (aiBlock && aiData) {
            const ago = formatDistanceToNow(new Date(aiData.created_at), { addSuffix: true, locale: sv });
            aiBlock.controllers = [{ name: "Senaste audit", status: ago, variant: "idle" }];
          } else if (aiBlock) {
            aiBlock.controllers = [{ name: "Status", status: "Ingen audit ännu", variant: "skip" }];
          }
        }

        setBlocks(results);
        setLogTime(logData.created_at);
      }
    }

    fetchLatest();

    const channel = supabase
      .channel("automation-feature-status")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "auto_cooling_decision_logs" }, () => fetchLatest())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "auto_cooling_decision_logs" }, () => fetchLatest())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [autoCoolingEnabled, pillCompEnabled, stallDetectionEnabled, overshootPreventionEnabled, aiAuditEnabled]);

  if (blocks.length === 0) return null;

  const variantColor = (v: ControllerLine["variant"]) =>
    v === "action" ? "text-accent" : v === "skip" ? "text-muted-foreground/40" : "text-muted-foreground/70";

  return (
    <div className="space-y-3 pt-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
        Senaste cykel
        {logTime && (
          <span className="ml-1 font-normal">
            ({formatDistanceToNow(new Date(logTime), { addSuffix: true, locale: sv })})
          </span>
        )}
      </span>

      {blocks.map((block) => (
        <div key={block.label} className="space-y-0.5">
          {/* Feature header */}
          <div className="flex items-center gap-2 text-xs px-1">
            <block.icon className={`h-3 w-3 shrink-0 ${block.hasAction ? "text-accent" : "text-muted-foreground/60"}`} />
            <span className={`font-medium ${block.hasAction ? "text-accent" : "text-muted-foreground"}`}>
              {block.label}
            </span>
          </div>

          {/* Per-controller lines */}
          {block.controllers.map((ctrl) => (
            <div key={`${block.label}-${ctrl.name}`} className="flex items-center justify-between text-[11px] pl-6 pr-1 py-px">
              <span className={`truncate ${variantColor(ctrl.variant)}`}>{ctrl.name}</span>
              <span className={`shrink-0 ml-2 text-right ${ctrl.variant === "action" ? "text-accent font-medium" : variantColor(ctrl.variant)}`}>
                {ctrl.status}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
