import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Snowflake, Flame, Waves, Thermometer, Radio } from "lucide-react";

interface ControllerRow {
  controller_id: string;
  name: string;
  actual_temp: number | null;
  current_temp: number | null;
  pill_temp: number | null;
  target_temp: number | null;
  profile_target_temp: number | null;
  is_glycol_cooler: boolean;
  linked_pill_id: string | null;
  last_update: string | null;
}

interface LiveRow {
  controller_id: string;
  duty_pct: number;
  target_temp: number | null;
  cooling_relay_on: boolean;
  heating_relay_on: boolean;
  sensor_source: string | null;
  mode: string | null;
  enabled: boolean | null;
  glycol_temp: number | null;
  pump_started_at: string | null;
  pump_stopped_at: string | null;
  last_heartbeat: string;
}

interface PillRow {
  pill_id: string;
  name: string;
  color: string;
  gravity: number | null;
  temperature: number | null;
  battery_level: number;
}

function fmtTemp(v: number | null | undefined) {
  return v == null ? "–" : v.toFixed(1) + "°";
}

function fmtTime(ts: string | null) {
  if (!ts) return "–";
  return new Date(ts).toLocaleString("sv-SE", { hour: "2-digit", minute: "2-digit" });
}

function RelayBadge({ on, label, icon: Icon, activeClass }: { on: boolean; label: string; icon: typeof Snowflake; activeClass: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
        on ? activeClass : "border-border/40 text-muted-foreground/50"
      }`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

export function DeviceOverviewPanel() {
  const [controllers, setControllers] = useState<ControllerRow[]>([]);
  const [live, setLive] = useState<LiveRow[]>([]);
  const [pills, setPills] = useState<PillRow[]>([]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const [c, l, p] = await Promise.all([
        supabase.from("rapt_temp_controllers").select("controller_id, name, actual_temp, current_temp, pill_temp, target_temp, profile_target_temp, is_glycol_cooler, linked_pill_id, last_update"),
        supabase.from("pi_live_state").select("controller_id, duty_pct, target_temp, cooling_relay_on, heating_relay_on, sensor_source, mode, enabled, glycol_temp, pump_started_at, pump_stopped_at, last_heartbeat"),
        supabase.from("rapt_pills").select("pill_id, name, color, gravity, temperature, battery_level"),
      ]);
      if (!mounted) return;
      setControllers(c.data ?? []);
      setLive(l.data ?? []);
      setPills(p.data ?? []);
    };
    load();
    const iv = setInterval(load, 15000);
    return () => {
      mounted = false;
      clearInterval(iv);
    };
  }, []);

  const tanks = controllers.filter((c) => !c.is_glycol_cooler);
  const cooler = controllers.find((c) => c.is_glycol_cooler);
  const liveFor = (id: string) => live.find((l) => l.controller_id === id || id.startsWith(l.controller_id));

  const renderCard = (c: ControllerRow) => {
    const lv = liveFor(c.controller_id);
    const pill = c.linked_pill_id ? pills.find((p) => p.pill_id === c.linked_pill_id) : undefined;
    const color = pill?.color || "#3b82f6";
    const pumpRunning = lv ? lv.cooling_relay_on || lv.heating_relay_on : false;

    return (
      <div
        key={c.controller_id}
        className="rounded-xl border border-border/50 p-4 flex flex-col gap-3"
        style={{ background: "hsl(var(--card) / 0.7)", borderLeft: `3px solid ${color}` }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-sm truncate" style={{ color }}>{c.name}</span>
          <span className="text-[10px] text-muted-foreground font-mono">{fmtTime(c.last_update)}</span>
        </div>

        {/* Givare */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Aktuell</p>
            <p className="text-lg font-bold font-mono">{fmtTemp(c.actual_temp ?? c.current_temp)}</p>
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Mål</p>
            <p className="text-lg font-bold font-mono text-muted-foreground">{fmtTemp(lv?.target_temp ?? c.target_temp)}</p>
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{c.is_glycol_cooler ? "Glykol" : "Pill"}</p>
            <p className="text-lg font-bold font-mono">{fmtTemp(c.is_glycol_cooler ? lv?.glycol_temp ?? c.current_temp : c.pill_temp ?? pill?.temperature)}</p>
          </div>
        </div>

        {!c.is_glycol_cooler && pill && (
          <div className="flex items-center justify-between text-[11px] text-muted-foreground border-t border-border/30 pt-2">
            <span className="flex items-center gap-1">
              <Radio className="h-3 w-3" style={{ color }} />
              {pill.name}
            </span>
            <span className="font-mono">
              SG {pill.gravity != null ? pill.gravity.toFixed(3) : "–"} · {pill.battery_level}%
            </span>
          </div>
        )}

        {/* Styrsignaler */}
        <div className="flex items-center justify-between gap-2 border-t border-border/30 pt-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <RelayBadge on={!!lv?.cooling_relay_on} label="Kyla" icon={Snowflake} activeClass="border-sky-400/50 text-sky-400" />
            {!c.is_glycol_cooler && (
              <RelayBadge on={!!lv?.heating_relay_on} label="Värme" icon={Flame} activeClass="border-orange-400/50 text-orange-400" />
            )}
            {!c.is_glycol_cooler && (
              <RelayBadge on={pumpRunning} label="Pump" icon={Waves} activeClass="border-emerald-400/50 text-emerald-400" />
            )}
          </div>
          <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
            Duty {lv ? Math.round(lv.duty_pct) + "%" : "–"}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">{tanks.map(renderCard)}</div>
      {cooler && (
        <div className="grid gap-3 sm:grid-cols-3">
          {renderCard(cooler)}
          <div className="hidden sm:block sm:col-span-2" />
        </div>
      )}
    </div>
  );
}
