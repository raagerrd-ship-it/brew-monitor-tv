import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Snowflake, Flame } from "lucide-react";

type Row = {
  controller_id: string;
  name: string;
  enabled: boolean;
  mode_allowed: string;
  target_temp: number;
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
      .select("controller_id, enabled, mode_allowed, target_temp")
      .in("controller_id", controllers.map((c) => c.controller_id));

    setRows(
      controllers.map((c) => {
        const sp = setpoints?.find((s) => s.controller_id === c.controller_id);
        return {
          controller_id: c.controller_id,
          name: c.name,
          enabled: sp?.enabled ?? true,
          mode_allowed: sp?.mode_allowed ?? "both",
          target_temp: Number(sp?.target_temp ?? 0),
        };
      })
    );
  };

  useEffect(() => {
    load();
  }, []);

  const update = async (id: string, patch: { enabled?: boolean; mode_allowed?: string }) => {
    setRows((prev) => prev.map((r) => (r.controller_id === id ? { ...r, ...patch } : r)));
    await supabase
      .from("pi_setpoint")
      .update({ ...patch, set_by: "cloud", set_at: new Date().toISOString() })
      .eq("controller_id", id);
  };

  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">Inga Pi-styrda tankar.</p>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {rows.map((row) => (
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
            <Switch
              checked={row.enabled}
              onCheckedChange={(v) => update(row.controller_id, { enabled: v })}
            />
          </div>

          <div className="text-xs text-muted-foreground">
            {row.enabled ? `Mål ${row.target_temp.toFixed(1)}°` : "Inaktiverad"}
          </div>

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
      ))}
    </div>
  );
}
