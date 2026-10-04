import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface BrewDayItem {
  id: string;
  name: string;
  amount: number | null;
  unit: string | null;
  at_min: number | null;
  checked: boolean;
}

export interface BrewDay {
  recipe_name: string | null;
  step_title: string | null;
  step_kind: string | null;
  target_temp_c: number | null;
  items: BrewDayItem[];
  updated_at: string;
}

const STALE_MS = 6 * 60 * 60 * 1000;

type Row = (BrewDay & { active: boolean }) | null;
type Listener = (row: Row | undefined) => void; // undefined = ladda om
const listeners = new Set<Listener>();

/** Anropas från data-updates-kanalen i useBrewData (realtid eller omladdning). */
export function notifyBrewDay(row?: Row) {
  listeners.forEach((l) => l(row));
}

/** Aktiv bryggdag från Brew Master Dashboard, eller null. Realtid via den gemensamma data-kanalen. */
export function useBrewDay(): BrewDay | null {
  const [row, setRow] = useState<Row>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("brew_day_session").select("*").eq("id", 1).maybeSingle();
      setRow((data as any) ?? null);
    };
    load();
    const listener: Listener = (r) => (r === undefined ? load() : setRow(r));
    listeners.add(listener);
    const poll = setInterval(load, 60_000);
    const stale = setInterval(() => setTick((t) => t + 1), 60_000);
    const resume = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      listeners.delete(listener);
      clearInterval(poll);
      clearInterval(stale);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, []);

  if (!row?.active || Date.now() - new Date(row.updated_at).getTime() > STALE_MS) return null;
  return row;
}
