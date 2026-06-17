import { useEffect, useState } from "react";
import { Power, PowerOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function PlugControl({ compact = false }: { compact?: boolean }) {
  const [isOn, setIsOn] = useState<boolean | null>(null);
  const [sending, setSending] = useState(false);

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

  const stateLabel = isOn === true ? "PÅ" : isOn === false ? "AV" : "—";
  const stateColor =
    isOn === true
      ? "hsl(142 70% 45%)"
      : isOn === false
        ? "hsl(0 0% 55%)"
        : "hsl(0 0% 40%)";

  const btnSize = compact ? "h-6 px-1.5 text-[10px]" : "h-7 px-2 text-[11px]";

  return (
    <div className="flex items-center gap-1.5">
      <div
        className="flex items-center gap-1 rounded-full px-2 py-0.5"
        style={{
          background: "hsl(0 0% 100% / 0.06)",
          border: `1px solid ${stateColor}`,
        }}
        title={`Plugg: ${stateLabel}`}
      >
        <span
          className="rounded-full"
          style={{
            width: 6,
            height: 6,
            background: stateColor,
            boxShadow: isOn ? `0 0 6px ${stateColor}` : "none",
          }}
        />
        <span
          className="text-[10px] font-semibold tracking-wide"
          style={{ color: stateColor }}
        >
          Plugg {stateLabel}
        </span>
      </div>
      <button
        type="button"
        disabled={sending}
        onClick={() => sendCommand("on")}
        className={`rounded ${btnSize} font-medium inline-flex items-center gap-1 transition-opacity disabled:opacity-40`}
        style={{
          background: "hsl(142 50% 25% / 0.6)",
          color: "hsl(142 70% 75%)",
          border: "1px solid hsl(142 50% 35%)",
        }}
        title="Sätt på pluggen"
      >
        <Power className="w-3 h-3" />
        Sätt på
      </button>
      <button
        type="button"
        disabled={sending}
        onClick={() => sendCommand("off")}
        className={`rounded ${btnSize} font-medium inline-flex items-center gap-1 transition-opacity disabled:opacity-40`}
        style={{
          background: "hsl(0 0% 18%)",
          color: "hsl(0 0% 80%)",
          border: "1px solid hsl(0 0% 28%)",
        }}
        title="Stäng av pluggen"
      >
        <PowerOff className="w-3 h-3" />
        Stäng av
      </button>
    </div>
  );
}