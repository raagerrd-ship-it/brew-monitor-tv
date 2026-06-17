import { useEffect, useState } from "react";
import { Power, PowerOff, Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface WatchdogEvent {
  id: string;
  controller: string | null;
  last_reading_at: string | null;
  age_minutes: number | null;
  action: string | null;
  created_at: string;
}

export function PlugControl({ compact: _compact = false }: { compact?: boolean }) {
  const [isOn, setIsOn] = useState<boolean | null>(null);
  const [sending, setSending] = useState(false);
  const [events, setEvents] = useState<WatchdogEvent[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("plug_state")
        .select("is_on")
        .eq("id", 1)
        .maybeSingle();
      if (!cancelled) setIsOn((data?.is_on ?? null) as boolean | null);
    };
    load();

    const channel = supabase
      .channel("plug_state_changes")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "plug_state", filter: "id=eq.1" },
        (payload) => setIsOn(((payload.new as any)?.is_on ?? null) as boolean | null),
      )
      .subscribe();

    const poll = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadEvents = async () => {
      const { data } = await supabase
        .from("watchdog_log")
        .select("id,controller,last_reading_at,age_minutes,action,created_at")
        .order("created_at", { ascending: false })
        .limit(5);
      if (!cancelled) setEvents((data ?? []) as WatchdogEvent[]);
    };
    loadEvents();

    const channel = supabase
      .channel("watchdog_log_changes")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "watchdog_log" },
        () => loadEvents(),
      )
      .subscribe();

    const poll = setInterval(loadEvents, 60000);
    return () => {
      cancelled = true;
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, []);

  const sendCommand = async (command: "on" | "off") => {
    setSending(true);
    const { error } = await supabase
      .from("plug_commands")
      .insert({ command, source: "manual" });
    setSending(false);
    if (error) {
      toast.error("Kunde inte skicka kommando");
      return;
    }
    toast.success("Kommando skickat till pluggen");
  };

  const stateLabel = isOn === true ? "På" : isOn === false ? "Av" : "—";
  const stateColor =
    isOn === true
      ? "hsl(142 70% 45%)"
      : isOn === false
        ? "hsl(0 0% 55%)"
        : "hsl(0 0% 40%)";

  const hasRecentEvent =
    events.length > 0 &&
    Date.now() - new Date(events[0].created_at).getTime() < 60 * 60 * 1000;

  return (
    <div
      className="flex flex-col items-end justify-between h-[52px]"
      style={{ fontFamily: "Inter, sans-serif" }}
    >
      {/* Row 1 — status, matches Clock time row (25px) */}
      <div className="flex items-center h-[25px] gap-2">
        <span className="relative flex h-1.5 w-1.5">
          {isOn && (
            <span
              className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60"
              style={{ background: stateColor }}
            />
          )}
          <span
            className="relative inline-flex rounded-full h-1.5 w-1.5"
            style={{
              background: stateColor,
              boxShadow: isOn ? `0 0 8px ${stateColor}` : "none",
            }}
          />
        </span>
        <span className="text-[10px] font-medium tracking-[0.22em] uppercase text-white/40">
          Plugg
        </span>
      </div>

      {/* Row 2 — segmented glass control, matches Clock date row (15px) */}
      <div className="flex items-center h-[15px]">
        <div className="flex items-center bg-white/5 rounded-full p-[1px] border border-white/10 backdrop-blur-md">
          {/* Power On */}
          <button
            type="button"
            disabled={sending || isOn === true}
            onClick={() => sendCommand("on")}
            className="flex items-center justify-center w-8 h-[18px] rounded-full transition-colors hover:bg-white/15 disabled:cursor-default"
            style={{
              background: isOn === true ? "hsl(142 70% 45% / 0.18)" : "transparent",
              color: isOn === true ? "hsl(142 70% 55%)" : "hsl(142 60% 50% / 0.7)",
            }}
            title="Sätt på pluggen"
            aria-label="Sätt på pluggen"
          >
            <Power className="w-2.5 h-2.5" strokeWidth={3} />
          </button>

          {/* Power Off */}
          <button
            type="button"
            disabled={sending || isOn === false}
            onClick={() => sendCommand("off")}
            className="flex items-center justify-center w-8 h-[18px] rounded-full transition-colors hover:bg-white/10 disabled:cursor-default"
            style={{
              background: isOn === false ? "hsl(0 0% 100% / 0.1)" : "transparent",
              color: isOn === false ? "hsl(0 0% 85%)" : "hsl(0 0% 55%)",
            }}
            title="Stäng av pluggen"
            aria-label="Stäng av pluggen"
          >
            <PowerOff className="w-2.5 h-2.5" strokeWidth={3} />
          </button>

          {/* Watchdog */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="relative flex items-center justify-center w-8 h-[18px] rounded-full transition-colors hover:bg-white/10"
                style={{
                  color: hasRecentEvent ? "hsl(38 92% 60%)" : "hsl(0 0% 45%)",
                }}
                title="Watchdog-händelser"
                aria-label="Watchdog-händelser"
              >
                <Shield className="w-2.5 h-2.5" strokeWidth={3} />
                {hasRecentEvent && (
                  <span
                    className="absolute top-0.5 right-1 rounded-full"
                    style={{
                      width: 4,
                      height: 4,
                      background: "hsl(38 92% 55%)",
                      boxShadow: "0 0 4px hsl(38 92% 55%)",
                    }}
                  />
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent
          align="end"
          className="w-80 p-3"
          style={{ background: "hsl(222 20% 10%)", border: "1px solid hsl(0 0% 100% / 0.1)" }}
        >
          <div className="text-[11px] font-semibold mb-2 text-foreground/80 uppercase tracking-wider">
            Senaste watchdog-händelser
          </div>
          {events.length === 0 ? (
            <div className="text-[11px] text-foreground/50 py-2">
              Inga händelser ännu.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {events.map((e) => {
                const triggered = e.action === "restart_triggered";
                return (
                  <li
                    key={e.id}
                    className="text-[11px] flex items-start gap-2 rounded px-2 py-1.5"
                    style={{ background: "hsl(0 0% 100% / 0.03)" }}
                  >
                    <span
                      className="rounded-full mt-1 flex-shrink-0"
                      style={{
                        width: 6,
                        height: 6,
                        background: triggered ? "hsl(0 70% 55%)" : "hsl(38 80% 50%)",
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium truncate">
                          {e.controller ?? "—"}
                        </span>
                        <span className="text-foreground/50 tabular-nums whitespace-nowrap">
                          {new Date(e.created_at).toLocaleString("sv-SE", {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <div className="text-foreground/60 mt-0.5">
                        {e.age_minutes != null
                          ? `Senaste data ${Number(e.age_minutes).toFixed(0)} min sedan`
                          : "—"}
                        {" · "}
                        <span style={{ color: triggered ? "hsl(0 70% 65%)" : "hsl(38 80% 60%)" }}>
                          {triggered ? "Restart skickad" : "Cooldown – hoppades över"}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
}