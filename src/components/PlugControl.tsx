import { useEffect, useState } from "react";
import { Plug, Power, PowerOff, Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HeaderIconButton } from "./header/HeaderIconButton";

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
  const [watchdogOpen, setWatchdogOpen] = useState(false);

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
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <HeaderIconButton
            icon={<Plug strokeWidth={2} />}
            label={`Plugg: ${stateLabel}`}
            disabled={sending}
            active={isOn === true}
            iconColor={stateColor}
            dotColor={
              isOn === false
                ? "hsl(0 70% 55%)"
                : hasRecentEvent
                  ? "hsl(38 92% 55%)"
                  : undefined
            }
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-56"
          style={{
            background: "hsl(222 20% 10%)",
            border: "1px solid hsl(0 0% 100% / 0.1)",
          }}
        >
          <div className="px-2 py-1.5 text-[11px] font-semibold text-foreground/50 uppercase tracking-wider">
            Plugg: {stateLabel}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => sendCommand("on")}
            disabled={isOn === true}
            className="text-xs gap-2 cursor-pointer"
          >
            <Power className="w-4 h-4 text-emerald-500" />
            Sätt på pluggen
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => sendCommand("off")}
            disabled={isOn === false}
            className="text-xs gap-2 cursor-pointer"
          >
            <PowerOff className="w-4 h-4" />
            Stäng av pluggen
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setWatchdogOpen(true)}
            className="text-xs gap-2 cursor-pointer"
          >
            <Shield className="w-4 h-4" />
            Watchdog-händelser
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={watchdogOpen} onOpenChange={setWatchdogOpen}>
        <DialogContent
          className="w-80 p-3"
          style={{
            background: "hsl(222 20% 10%)",
            border: "1px solid hsl(0 0% 100% / 0.1)",
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-[11px] font-semibold text-foreground/80 uppercase tracking-wider">
              Senaste watchdog-händelser
            </DialogTitle>
          </DialogHeader>
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
                        <span
                          style={{
                            color: triggered ? "hsl(0 70% 65%)" : "hsl(38 80% 60%)",
                          }}
                        >
                          {triggered ? "Restart skickad" : "Cooldown – hoppades över"}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
