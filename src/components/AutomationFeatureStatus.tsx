import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Snowflake, Wrench, AlertTriangle, Shield, Brain, Clock, TrendingDown, TrendingUp } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";

function SyncCountdown({ lastSyncTime, intervalSeconds }: { lastSyncTime: string; intervalSeconds: number }) {
  const [text, setText] = useState("");
  const lastSecondRef = useRef(-1);

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const sec = Math.floor(now / 1000);
      if (sec === lastSecondRef.current) return;
      lastSecondRef.current = sec;

      const next = new Date(lastSyncTime).getTime() + intervalSeconds * 1000;
      const diff = Math.max(0, Math.ceil((next - now) / 1000));
      if (diff <= 0) {
        setText("Synkar...");
      } else {
        const m = Math.floor(diff / 60);
        const s = diff % 60;
        setText(m > 0 ? `${m}m ${s}s` : `${s}s`);
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [lastSyncTime, intervalSeconds]);

  return (
    <div className="flex items-center justify-between text-[10px] pl-6 pr-1 pt-1.5 text-muted-foreground/50">
      <div className="flex items-center gap-1">
        <Clock className="h-2.5 w-2.5" />
        <span>Nästa synk</span>
      </div>
      <span className="font-mono">{text}</span>
    </div>
  );
}

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
  extra?: React.ReactNode;
}

interface AvailableController {
  id: string;
  controller_id: string;
  name: string;
  current_temp: number | null;
  pill_temp?: number | null;
  target_temp: number | null;
  profile_target_temp?: number | null;
  cooling_enabled: boolean | null;
  heating_enabled: boolean | null;
  is_glycol_cooler: boolean;
}

interface LastAdjustment {
  created_at: string;
  old_target_temp: number;
  new_target_temp: number;
}

interface Props {
  autoCoolingEnabled: boolean;
  pillCompEnabled: boolean;
  stallDetectionEnabled: boolean;
  overshootPreventionEnabled: boolean;
  aiAuditEnabled: boolean;
  availableControllers: AvailableController[];
  coolerControllerId: string | null;
  followedControllerIds: string[];
  lastAdjustment: LastAdjustment | null;
  lastAutoCoolingCheck: string | null;
  autoCoolingInterval: string;
}

function buildFeatureBlocks(
  decisions: DecisionEntry[],
  props: Props,
): FeatureBlock[] {
  const blocks: FeatureBlock[] = [];
  const { availableControllers, coolerControllerId, followedControllerIds } = props;

  // All non-cooler controllers
  const allNonCooler = availableControllers.filter(c => c.controller_id !== coolerControllerId && !c.is_glycol_cooler);
  const cooler = availableControllers.find(c => c.controller_id === coolerControllerId || c.is_glycol_cooler);

  // 1. Glycol cooling — show cooler + ALL controllers
  if (props.autoCoolingEnabled) {
    const glycolActions = decisions.filter(d => d.step === "ADJUSTMENT" && d.result === "action");
    const controllers: ControllerLine[] = [];

    // Cooler line
    if (cooler) {
      const current = cooler.current_temp != null ? Number(cooler.current_temp).toFixed(1) : null;
      const target = cooler.target_temp != null ? Number(cooler.target_temp).toFixed(1) : null;
      const isActivelyCooling = cooler.cooling_enabled && cooler.current_temp != null && cooler.target_temp != null && Number(cooler.current_temp) > Number(cooler.target_temp);

      let status = "";
      if (current && target) status = `${current}° → ${target}°`;
      else if (target) status = `mål ${target}°`;

      const suffix = isActivelyCooling ? " ❄ Kyler" : cooler.cooling_enabled ? " ✓ Vid mål" : " Av";
      controllers.push({
        name: `⛄ ${cooler.name}`,
        status: status + suffix,
        variant: isActivelyCooling ? "action" : glycolActions.length > 0 ? "action" : "idle",
      });
    }

    // Followed controllers — show profile_target_temp (interpolated) and target_temp (actual setpoint)
    for (const c of allNonCooler) {
      const isFollowed = followedControllerIds.includes(c.controller_id);

      if (!isFollowed) {
        controllers.push({ name: c.name, status: "Ej följd", variant: "skip" });
      } else if (!c.cooling_enabled && !c.heating_enabled) {
        controllers.push({ name: c.name, status: "Inaktiv", variant: "skip" });
      } else {
        const profileTemp = c.profile_target_temp != null ? Number(c.profile_target_temp).toFixed(1) : null;
        const setpoint = c.target_temp != null ? Number(c.target_temp).toFixed(1) : null;

        if (profileTemp && setpoint) {
          const diff = Number(setpoint) - Number(profileTemp);
          const kompStr = Math.abs(diff) >= 0.1 ? ` (${diff >= 0 ? "+" : ""}${diff.toFixed(1)}°)` : "";
          controllers.push({ name: c.name, status: `${profileTemp}° → ${setpoint}°${kompStr}`, variant: "idle" });
        } else if (setpoint) {
          controllers.push({ name: c.name, status: `mål ${setpoint}°`, variant: "idle" });
        } else {
          controllers.push({ name: c.name, status: "—", variant: "idle" });
        }
      }
    }

    blocks.push({ icon: Snowflake, label: "Glykolkylare", controllers, hasAction: glycolActions.length > 0 });
  }

  // 2. PID / Pill compensation — show ALL controllers
  if (props.pillCompEnabled) {
    const controllers: ControllerLine[] = [];

    for (const c of allNonCooler) {
      const name = c.name;
      const isFollowed = followedControllerIds.includes(c.controller_id);

      if (!isFollowed) {
        controllers.push({ name, status: "Ej följd", variant: "skip" });
        continue;
      }

      const action = decisions.find(d =>
        d.step === "PILL_COMP_ACTION" && d.result === "action" && d.message.startsWith(name)
      );
      const skip = decisions.find(d =>
        d.step === "PILL_COMP_SKIP" && d.message.startsWith(name)
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
      } else if (skip) {
        if (skip.message.includes("Samma data")) {
          controllers.push({ name, status: "Ingen ny data", variant: "idle" });
        } else if (skip.message.includes("cooloff")) {
          controllers.push({ name, status: "Cooloff aktiv", variant: "skip" });
        } else if (skip.message.includes("no active session") || skip.message.includes("profile-owned but no")) {
          controllers.push({ name, status: "Ingen session", variant: "skip" });
        } else {
          controllers.push({ name, status: "Skippade", variant: "idle" });
        }
      } else {
        // Check if controller has cooling/heating active — if so it's running, just no PID change
        const isActive = c.cooling_enabled || c.heating_enabled;
        controllers.push({ name, status: isActive ? "Ingen ändring" : "Ej aktiv", variant: isActive ? "idle" : "skip" });
      }
    }

    blocks.push({
      icon: Wrench, label: "PID-kompensation", controllers,
      hasAction: controllers.some(c => c.variant === "action"),
    });
  }

  // 3. Stall detection — show ALL controllers
  if (props.stallDetectionEnabled) {
    const controllers: ControllerLine[] = [];

    for (const c of allNonCooler) {
      const name = c.name;
      const isFollowed = followedControllerIds.includes(c.controller_id);

      if (!isFollowed) {
        controllers.push({ name, status: "Ej följd", variant: "skip" });
        continue;
      }

      const boost = decisions.find(d =>
        d.step === "STALL_BOOST" && d.result === "action" && d.message.startsWith(name)
      );
      const unboost = decisions.find(d =>
        d.step === "STALL_UNBOOST" && d.result === "action" && d.message.startsWith(name)
      );

      if (boost) {
        const match = boost.message.match(/boost \+([\d.]+)°C/i);
        controllers.push({ name, status: match ? `Boost +${match[1]}°` : "Boost", variant: "action" });
      } else if (unboost) {
        controllers.push({ name, status: "Un-boost", variant: "action" });
      } else {
        controllers.push({ name, status: "Ingen stall", variant: "idle" });
      }
    }

    blocks.push({
      icon: AlertTriangle, label: "Stall-detektering", controllers,
      hasAction: controllers.some(c => c.variant === "action"),
    });
  }

  // 4. Overshoot prevention — show ALL controllers
  if (props.overshootPreventionEnabled) {
    const controllers: ControllerLine[] = [];

    for (const c of allNonCooler) {
      const name = c.name;
      const isFollowed = followedControllerIds.includes(c.controller_id);

      if (!isFollowed) {
        controllers.push({ name, status: "Ej följd", variant: "skip" });
        continue;
      }

      const overshoot = decisions.find(d =>
        d.message.toLowerCase().includes("overshoot") && d.result === "action" && d.message.includes(name)
      );
      controllers.push({
        name, status: overshoot ? "Åtgärd" : "OK",
        variant: overshoot ? "action" : "idle",
      });
    }

    blocks.push({
      icon: Shield, label: "Overshoot-prevention", controllers,
      hasAction: controllers.some(c => c.variant === "action"),
    });
  }

  // 5. AI audit
  if (props.aiAuditEnabled) {
    blocks.push({ icon: Brain, label: "AI-optimering", controllers: [], hasAction: false });
  }

  return blocks;
}

interface RampInfo {
  controllerName: string;
  currentTarget: number;
  upcomingTarget: number;
  rampRate: number;
  direction: "down" | "up";
}

export function AutomationFeatureStatus(props: Props) {
  const [blocks, setBlocks] = useState<FeatureBlock[]>([]);
  const [logTime, setLogTime] = useState<string | null>(null);
  const [activeRamps, setActiveRamps] = useState<RampInfo[]>([]);

  const { autoCoolingEnabled, pillCompEnabled, stallDetectionEnabled, overshootPreventionEnabled, aiAuditEnabled, availableControllers, coolerControllerId, followedControllerIds, lastAdjustment } = props;

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
          ? supabase.from("ai_audit_log").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      const decisions = logData ? (logData.decisions as unknown as DecisionEntry[]) || [] : [];
      const results = buildFeatureBlocks(decisions, props);

      // Extract active ramp info from PROACTIVE_NEED decisions
      const ramps: RampInfo[] = [];
      for (const d of decisions) {
        if (d.step === "PROACTIVE_NEED" && d.result === "info") {
          // Parse: "ControllerName: 19.5°C → 18.0°C @ 0.30°C/h (gradual_ramp, pågår nu)"
          const match = d.message.match(/^(.+?):\s*([\d.]+)°C\s*→\s*([\d.]+)°C\s*@\s*([\d.]+)°C\/h\s*\((\w+),\s*pågår nu\)/);
          if (match) {
            const current = parseFloat(match[2]);
            const upcoming = parseFloat(match[3]);
            ramps.push({
              controllerName: match[1].trim(),
              currentTarget: current,
              upcomingTarget: upcoming,
              rampRate: parseFloat(match[4]),
              direction: upcoming < current ? "down" : "up",
            });
          }
        }
      }
      setActiveRamps(ramps);

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
      setLogTime(logData?.created_at ?? null);
    }

    fetchLatest();

    const channel = supabase
      .channel("automation-feature-status")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "auto_cooling_decision_logs" }, () => fetchLatest())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "auto_cooling_decision_logs" }, () => fetchLatest())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [autoCoolingEnabled, pillCompEnabled, stallDetectionEnabled, overshootPreventionEnabled, aiAuditEnabled, availableControllers, coolerControllerId, followedControllerIds, lastAdjustment]);

  if (blocks.length === 0) return null;

  const variantColor = (v: ControllerLine["variant"]) =>
    v === "action" ? "text-accent" : v === "skip" ? "text-muted-foreground/40" : "text-muted-foreground/70";

  return (
    <div className="space-y-3 pt-1">
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
          <div className="flex items-center gap-2 text-xs px-1">
            <block.icon className={`h-3 w-3 shrink-0 ${block.hasAction ? "text-accent" : "text-muted-foreground/60"}`} />
            <span className={`font-medium ${block.hasAction ? "text-accent" : "text-muted-foreground"}`}>
              {block.label}
            </span>
          </div>

          {block.controllers.map((ctrl) => (
            <div key={`${block.label}-${ctrl.name}`} className="flex items-center justify-between text-[11px] pl-6 pr-1 py-px">
              <span className={`truncate ${variantColor(ctrl.variant)}`}>{ctrl.name}</span>
              <span className={`shrink-0 ml-2 text-right ${ctrl.variant === "action" ? "text-accent font-medium" : variantColor(ctrl.variant)}`}>
                {ctrl.status}
              </span>
            </div>
          ))}

          {block.extra}

          {/* Active ramp indicators — under Glykolkylare */}
          {block.label === "Glykolkylare" && activeRamps.length > 0 && activeRamps.map((ramp, i) => (
            <div key={`ramp-${i}`} className="flex items-center justify-between text-[11px] pl-6 pr-1 pt-0.5">
              <div className="flex items-center gap-1 text-accent">
                {ramp.direction === "down" ? (
                  <TrendingDown className="h-2.5 w-2.5" />
                ) : (
                  <TrendingUp className="h-2.5 w-2.5" />
                )}
                <span>Ramp aktiv</span>
              </div>
              <span className="text-accent font-medium">
                {ramp.controllerName} {ramp.direction === "down" ? "↓" : "↑"} {ramp.rampRate.toFixed(1)}°C/h
              </span>
            </div>
          ))}

          {/* Sync countdown — bottom of Glykolkylare */}
          {block.label === "Glykolkylare" && props.autoCoolingEnabled && props.lastAutoCoolingCheck && (
            <SyncCountdown
              lastSyncTime={props.lastAutoCoolingCheck}
              intervalSeconds={parseInt(props.autoCoolingInterval)}
            />
          )}
        </div>
      ))}
    </div>
  );
}
