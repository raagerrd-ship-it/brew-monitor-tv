import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Snowflake, Flame, Check, Loader2, AlertTriangle } from "lucide-react";

type Row = {
  controller_id: string;
  name: string;
  enabled: boolean;
  mode_allowed: string;
  target_temp: number;
  set_at: string | null;
  pi_enabled: boolean | null;
  pi_mode: string | null;
  last_heartbeat: string | null;
};

const MODES = [
  { value: "both", label: "Auto (kyla + värme)" },
  { value: "cooling", label: "Bara kyla" },
  { value: "heating", label: "Bara värme" },
  { value: "none", label: "Av" },
];

export function PiTankSettings() {
  const [rows, setRows] = useState<Row[]>([]);

  const load = async () => {
    const { data: controllers } = await supabase
      .from("rapt_temp_controllers")
      .select("controller_id, name")
      .eq("actuation", "pi");
    if (!controllers?.length) return setRows([]);

    const { data: setpoints } = await supabase
      .from("pi_setpoint")
      .select("controller_id, enabled, mode_allowed, target_temp, set_at")
      .in("controller_id", controllers.map((c) => c.controller_id));

    const { data: live } = await supabase
      .from("pi_live_state")
      .select("controller_id, enabled, mode_allowed, last_heartbeat")
      .in("controller_id", controllers.map((c) => c.controller_id));

    setRows(
      controllers.map((c) => {
        const sp = setpoints?.find((s) => s.controller_id === c.controller_id);
        const ls = live?.find((l) => l.controller_id === c.controller_id);
        return {
          controller_id: c.controller_id,
          name: c.name,
          enabled: sp?.enabled ?? true,
          mode_allowed: sp?.mode_allowed ?? "both",
          target_temp: Number(sp?.target_temp ?? 0),
          set_at: sp?.set_at ?? null,
          pi_enabled: ls?.enabled ?? null,
          pi_mode: ls?.mode_allowed ?? null,
          last_heartbeat: ls?.last_heartbeat ?? null,
        };
      })
    );
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const update = async (id: string, patch: { enabled?: boolean; mode_allowed?: string }) => {
    const setAt = new Date().toISOString();
    setRows((prev) => prev.map((r) => (r.controller_id === id ? { ...r, ...patch, set_at: setAt } : r)));
    await supabase
      .from("pi_setpoint")
      .update({ ...patch, set_by: "cloud", set_at: setAt })
      .eq("controller_id", id);
  };

  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">Inga Pi-styrda tankar.</p>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {rows.map((row) => {
        const hbMs = row.last_heartbeat ? Date.now() - new Date(row.last_heartbeat).getTime() : null;
        const silent = hbMs === null || hbMs > 10 * 60 * 1000;
        const applied =
          row.pi_enabled === row.enabled &&
          row.pi_mode === row.mode_allowed &&
          !!row.last_heartbeat &&
          !!row.set_at &&
          new Date(row.last_heartbeat) >= new Date(row.set_at);
        return (
        <div
          key={row.controller_id}
          className={`rounded-xl border p-4 space-y-3 bg-card/70 ${row.enabled ? "" : "opacity-50"}`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold flex items-center gap-1.5">
              {row.name}
              {row.mode_allowed === "cooling" && <Snowflake className="h-4 w-4 text-sky-400" />}
              {row.mode_allowed === "heating" && <Flame className="h-4 w-4 text-orange-400" />}
            </span>
            {!row.enabled && <span className="text-xs text-destructive">Av</span>}
          </div>

          <div className="text-xs text-muted-foreground">
            {row.enabled
              ? row.target_temp != null ? `Mål ${row.target_temp.toFixed(1)}°` : "Profilstyrt mål"
              : "Inaktiverad"}
          </div>

          <div className="text-xs flex items-center gap-1.5">
            {silent ? (
              <span className="flex items-center gap-1.5 text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                Pi tyst {hbMs === null ? "—" : `${Math.round(hbMs / 60000)} min`}
              </span>
            ) : applied ? (
              <span className="flex items-center gap-1.5 text-emerald-500">
                <Check className="h-3.5 w-3.5" />
                Kvitterad av Pi
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-amber-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Väntar på Pi
              </span>
            )}
          </div>
          {row.set_at && (
            <div className="text-[11px] text-muted-foreground">
              Skickat {new Date(row.set_at).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })}
            </div>
          )}

          <Select
            value={row.mode_allowed}
            onValueChange={(v) => update(row.controller_id, { mode_allowed: v })}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODES.map((m) => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        );
      })}
    </div>
  );
}
