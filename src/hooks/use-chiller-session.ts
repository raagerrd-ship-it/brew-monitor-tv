import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { chillerVisibility, type ChillerSession } from "@/lib/chiller-session";

type Listener = (row: ChillerSession | null | undefined) => void; // undefined = ladda om
const listeners = new Set<Listener>();

/** Anropas från data-updates-kanalen i useBrewData (realtid eller omladdning). */
export function notifyChiller(row?: ChillerSession | null) {
  listeners.forEach((l) => l(row));
}

/** Glykolkylarens session när kortet ska visas, annars null. */
export function useChillerSession(enabled: boolean): ChillerSession | null {
  const [row, setRowRaw] = useState<ChillerSession | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const setRow = (r: ChillerSession | null) => setRowRaw((prev) => (prev?.updated_at === r?.updated_at ? prev : r));
    const load = async () => {
      const { data } = await supabase.from("chiller_session").select("*").eq("id", "glycol").maybeSingle();
      setRow((data as unknown as ChillerSession) ?? null);
    };
    load();
    const listener: Listener = (r) => (r === undefined ? load() : setRow(r));
    listeners.add(listener);
    const resume = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      listeners.delete(listener);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [enabled]);

  const { visible, changeAt } = chillerVisibility(row, Date.now());
  // En timeout till exakt tidpunkten då synligheten ändras, ingen poll.
  useEffect(() => {
    if (changeAt == null) return;
    const t = setTimeout(() => setTick((n) => n + 1), Math.min(Math.max(changeAt - Date.now(), 0) + 100, 2_147_000_000));
    return () => clearTimeout(t);
  }, [changeAt]);

  return enabled && visible ? row : null;
}
