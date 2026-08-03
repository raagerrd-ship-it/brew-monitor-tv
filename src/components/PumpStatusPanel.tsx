import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Waves } from "lucide-react";

const PUMPS = [
  { key: "gul", label: "Gul", controllerId: "618b29b0", color: "hsl(45 90% 55%)" },
  { key: "gron", label: "Grön", controllerId: "6fbbc7db", color: "hsl(142 60% 50%)" },
  { key: "bla", label: "Blå", controllerId: "ffa62be4", color: "hsl(210 90% 60%)" },
] as const;

type Marks = Record<string, { start?: string; stop?: string; last?: boolean }>;

const STORAGE_KEY = "pump-status-marks";

function loadMarks(): Marks {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function fmt(ts?: string) {
  if (!ts) return "–";
  return new Date(ts).toLocaleString("sv-SE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PumpStatusPanel() {
  const [running, setRunning] = useState<Record<string, boolean | null>>({});
  const [marks, setMarks] = useState<Marks>(loadMarks);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const { data } = await supabase
        .from("pi_live_state")
        .select("controller_id, cooling_relay_on, heating_relay_on, updated_at");
      if (!mounted) return;

      const next: Record<string, boolean | null> = {};
      const stamps: Record<string, string> = {};
      for (const pump of PUMPS) {
        if (!pump.controllerId) {
          next[pump.key] = null; // ingen telemetri (RAPT-styrd)
          continue;
        }
        const row = data?.find((r) => r.controller_id === pump.controllerId);
        next[pump.key] = row ? !!(row.cooling_relay_on || row.heating_relay_on) : null;
        if (row?.updated_at) stamps[pump.key] = row.updated_at as string;
      }

      setMarks((prevMarks) => {
        let changed = false;
        const updated = { ...prevMarks };
        for (const pump of PUMPS) {
          const after = next[pump.key];
          if (after == null) continue;
          const before = updated[pump.key]?.last;
          const stamp = stamps[pump.key] ?? new Date().toISOString();
          // Första observationen: sätt tidpunkt direkt så rutan inte står tom
          if (before === undefined || before !== after) {
            updated[pump.key] = {
              ...updated[pump.key],
              [after ? "start" : "stop"]: stamp,
              last: after,
            };
            changed = true;
          }
        }
        if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        return changed ? updated : prevMarks;
      });
      setRunning(next);
    };

    load();
    const iv = setInterval(load, 10000);
    return () => {
      mounted = false;
      clearInterval(iv);
    };
  }, []);

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {PUMPS.map((pump) => {
        const state = running[pump.key];
        const on = state === true;
        return (
          <div
            key={pump.key}
            className="rounded-xl border p-4 flex flex-col gap-3"
            style={{
              borderColor: on ? pump.color : "hsl(var(--border))",
              background: "hsl(var(--card) / 0.7)",
            }}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-lg" style={{ color: pump.color }}>
                {pump.label}
              </span>
              <Waves
                className={on ? "animate-pulse" : "opacity-30"}
                style={{ color: on ? pump.color : undefined }}
              />
            </div>

            <div className="text-2xl font-bold">
              {state === null ? (
                <span className="text-muted-foreground text-base">Ingen telemetri</span>
              ) : on ? (
                <span style={{ color: pump.color }}>Kör</span>
              ) : (
                <span className="text-muted-foreground">Stoppad</span>
              )}
            </div>

            <div className="text-xs text-muted-foreground space-y-1">
              <div>Senaste start: {fmt(marks[pump.key]?.start)}</div>
              <div>Senaste stopp: {fmt(marks[pump.key]?.stop)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
