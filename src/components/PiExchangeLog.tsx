import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, ArrowUpRight, ArrowDownLeft, Beer } from "lucide-react";

interface SentRow {
  controller_id: string;
  name: string;
  target_temp: number | null;
  mode_allowed: string;
  enabled: boolean;
  set_at: string;
  set_by: string;
  acked: boolean;
}

interface ReceivedRow {
  controller_id: string;
  name: string;
  last_heartbeat: string;
  actual_temp: number | null;
  target_source: string | null;
}

interface QueuedBrew {
  id: string;
  name: string;
  pi_pending_at: string;
}

function ts(v: string) {
  return new Date(v).toLocaleString("sv-SE", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

export function PiExchangeLog() {
  const [sent, setSent] = useState<SentRow[]>([]);
  const [received, setReceived] = useState<ReceivedRow[]>([]);
  const [queued, setQueued] = useState<QueuedBrew[]>([]);
  const [lastAnalysis, setLastAnalysis] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [ctrlRes, spRes, liveRes, brewRes, syncRes] = await Promise.all([
      supabase.from("rapt_temp_controllers").select("controller_id, name"),
      supabase.from("pi_setpoint").select("controller_id, target_temp, mode_allowed, enabled, set_at, set_by, commanded_at").order("set_at", { ascending: false }),
      supabase.from("pi_live_state").select("controller_id, last_heartbeat, actual_temp, target_source").order("last_heartbeat", { ascending: false }),
      supabase.from("brew_readings").select("id, name, pi_pending_at").not("pi_pending_at", "is", null).order("pi_pending_at", { ascending: false }),
      supabase.from("sync_settings").select("last_rapt_quick_sync_at").limit(1).maybeSingle(),
    ]);

    const names = new Map((ctrlRes.data ?? []).map((c) => [c.controller_id, c.name]));
    const nameOf = (id: string) =>
      names.get(id) ?? [...names.entries()].find(([k]) => k.startsWith(id) || id.startsWith(k))?.[1] ?? id.slice(0, 8);

    setSent((spRes.data ?? []).map((sp) => ({
      controller_id: sp.controller_id,
      name: nameOf(sp.controller_id),
      target_temp: sp.target_temp != null ? Number(sp.target_temp) : null,
      mode_allowed: sp.mode_allowed,
      enabled: sp.enabled !== false,
      set_at: sp.set_at,
      set_by: sp.set_by,
      acked: !!sp.commanded_at && new Date(sp.commanded_at) >= new Date(sp.set_at),
    })));

    setReceived((liveRes.data ?? []).map((l) => ({
      controller_id: l.controller_id,
      name: nameOf(l.controller_id),
      last_heartbeat: l.last_heartbeat,
      actual_temp: l.actual_temp != null ? Number(l.actual_temp) : null,
      target_source: l.target_source,
    })));

    setQueued((brewRes.data ?? []).map((b) => ({ id: b.id, name: b.name, pi_pending_at: b.pi_pending_at! })));
    setLastAnalysis(syncRes.data?.last_rapt_quick_sync_at ?? null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          Senaste dataanalys: {lastAnalysis ? ts(lastAnalysis) : "–"}
        </p>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Skickat till Pi:n */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <ArrowUpRight className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold">Skickat till Pi:n (börvärden)</span>
        </div>
        {sent.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">Inga börvärden skickade.</p>
        ) : sent.map((s) => (
          <div key={s.controller_id} className="rounded-lg border border-border/40 bg-card/30 p-2.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium truncate">{s.name}</p>
              <p className="text-[10px] text-muted-foreground font-mono">
                {s.enabled ? (s.target_temp != null ? `${s.target_temp.toFixed(1)} °C` : "följer profil") : "reglering av"} · {s.mode_allowed} · {s.set_by}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] text-muted-foreground font-mono">{ts(s.set_at)}</span>
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${s.acked ? "border-success/40 text-success" : "border-muted-foreground/40 text-muted-foreground"}`}>
                {s.acked ? "Kvitterat" : "Väntar"}
              </Badge>
            </div>
          </div>
        ))}
      </div>

      {/* Mottaget från Pi:n */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <ArrowDownLeft className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold">Mottaget från Pi:n (telemetri)</span>
        </div>
        {received.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">Ingen telemetri mottagen.</p>
        ) : received.map((r) => (
          <div key={r.controller_id} className="rounded-lg border border-border/40 bg-card/30 p-2.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium truncate">{r.name}</p>
              <p className="text-[10px] text-muted-foreground font-mono">
                {r.actual_temp != null ? `${r.actual_temp.toFixed(2)} °C` : "–"}{r.target_source ? ` · mål: ${r.target_source}` : ""}
              </p>
            </div>
            <span className="text-[10px] text-muted-foreground font-mono shrink-0">{ts(r.last_heartbeat)}</span>
          </div>
        ))}
      </div>

      {/* Bryggder i kö */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Beer className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold">Bryggder i kö till Pi:n</span>
        </div>
        {queued.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">Inga bryggder väntar på kvittens.</p>
        ) : queued.map((b) => (
          <div key={b.id} className="rounded-lg border border-border/40 bg-card/30 p-2.5 flex items-center justify-between gap-3">
            <p className="text-xs font-medium truncate">{b.name}</p>
            <span className="text-[10px] text-muted-foreground font-mono shrink-0">{ts(b.pi_pending_at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
