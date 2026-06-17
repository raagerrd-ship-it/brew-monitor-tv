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
      {/* Row 1 — label, centered over segmented control */}
      <div className="flex items-center justify-center h-[18px] w-full leading-none">
        <span
          className="text-[10px] font-semibold tracking-[0.28em] uppercase"
          style={{
            color: isOn ? "hsl(0 0% 88%)" : "hsl(0 0% 50%)",
            transition: "color 300ms",
            paddingRight: "0.28em",
          }}
        >
          Plugg
        </span>
      </div>

      {/* Row 2 — segmented glass control, matches Clock date row (15px) */}
      <div className="flex items-center h-[15px]">
        <div
          className="flex items-center rounded-full p-[1.5px] backdrop-blur-md"
          style={{
            background: "hsl(0 0% 100% / 0.04)",
            border: "1px solid hsl(0 0% 100% / 0.08)",
            boxShadow:
              "inset 0 1px 0 hsl(0 0% 100% / 0.04), 0 1px 2px hsl(0 0% 0% / 0.4)",
          }}
        >
          {/* Power On */}
          <button
            type="button"
            disabled={sending || isOn === true}
            onClick={() => sendCommand("on")}
            className="flex items-center justify-center w-7 h-[18px] rounded-full transition-all duration-200 hover:bg-white/[0.06] disabled:cursor-default"
            style={{
              background:
                isOn === true
                  ? "radial-gradient(circle at 50% 40%, hsl(142 70% 50% / 0.32), hsl(142 70% 40% / 0.12))"
                  : "transparent",
              color:
                isOn === true ? "hsl(142 75% 70%)" : "hsl(142 30% 55% / 0.55)",
              boxShadow:
                isOn === true
                  ? "inset 0 0 0 1px hsl(142 70% 50% / 0.35), 0 0 8px hsl(142 70% 45% / 0.25)"
                  : "none",
            }}
            title="Sätt på pluggen"
            aria-label="Sätt på pluggen"
          >
            <Power className="w-2.5 h-2.5" strokeWidth={2.75} />
          </button>

          {/* Power Off */}
          <button
            type="button"
            disabled={sending || isOn === false}
            onClick={() => sendCommand("off")}
            className="flex items-center justify-center w-7 h-[18px] rounded-full transition-all duration-200 hover:bg-white/[0.06] disabled:cursor-default"
            style={{
              background:
                isOn === false
                  ? "hsl(0 0% 100% / 0.08)"
                  : "transparent",
              color:
                isOn === false ? "hsl(0 0% 92%)" : "hsl(0 0% 100% / 0.35)",
              boxShadow:
                isOn === false
                  ? "inset 0 0 0 1px hsl(0 0% 100% / 0.12)"
                  : "none",
            }}
            title="Stäng av pluggen"
            aria-label="Stäng av pluggen"
          >
            <PowerOff className="w-2.5 h-2.5" strokeWidth={2.75} />
          </button>

          {/* Watchdog */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="relative flex items-center justify-center w-7 h-[18px] rounded-full transition-all duration-200 hover:bg-white/[0.06]"
                style={{
                  color: hasRecentEvent
                    ? "hsl(38 92% 65%)"
                    : "hsl(0 0% 100% / 0.32)",
                }}
                title="Watchdog-händelser"
                aria-label="Watchdog-händelser"
              >
                <Shield className="w-2.5 h-2.5" strokeWidth={2.75} />
                {hasRecentEvent && (
                  <span
                    className="absolute top-[3px] right-[6px] rounded-full"
                    style={{
                      width: 4,
                      height: 4,
                      background: "hsl(38 92% 60%)",
                      boxShadow: "0 0 5px hsl(38 92% 55%)",
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