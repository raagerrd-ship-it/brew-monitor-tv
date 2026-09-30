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

const STALE_MS = 12 * 60 * 60 * 1000;

/** Aktiv bryggdag från Brew Master Dashboard, eller null. Egen realtidskanal. */
export function useBrewDay(): BrewDay | null {
  const [row, setRow] = useState<(BrewDay & { active: boolean }) | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("brew_day_session").select("*").eq("id", 1).maybeSingle();
      setRow((data as any) ?? null);
    };
    load();
    const channel = supabase
      .channel("brew-day")
      .on("postgres_changes", { event: "*", schema: "public", table: "brew_day_session" }, (p) => setRow(p.new as any))
      .subscribe((s) => { if (s === "SUBSCRIBED") load(); });
    return () => { supabase.removeChannel(channel); };
  }, []);

  if (!row?.active || Date.now() - new Date(row.updated_at).getTime() > STALE_MS) return null;
  return row;
}
