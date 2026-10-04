import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Pitch = { at?: string; amount?: number; amount_unit?: string; form?: string; yeast_temp_c?: number };
type Status = { og: number | null; og_source: string | null; og_measured: number | null; fg_expected: number | null; pitch: Pitch | null };

const sg = (v: number) => v.toFixed(3).replace(".", ",");
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(".", "");

// Visar Pi:ns pitch och OG/FG ordagrant från brew_status — inget räknas fram här.
export function PitchLine({ brewId, plannedOg }: { brewId: string; plannedOg: number | null }) {
  const [s, setS] = useState<Status | null>(null);

  useEffect(() => {
    let alive = true;
    supabase
      .from("brew_status")
      .select("og, og_source, og_measured, fg_expected, pitch")
      .or(`source_id.eq.${brewId},pi_brew_id.eq.${brewId}`)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => { if (alive) setS(data as Status | null); });
    return () => { alive = false; };
  }, [brewId]);

  if (!s) return null;
  const p = s.pitch;
  const og = s.og ?? (s.og_source === "pill" ? s.og_measured : null);
  const parts: string[] = [];
  if (og != null) parts.push(`OG ${sg(og)}${s.og_source === "pill" ? " (pillen)" : ""}`);
  if (s.og_source === "pill" && plannedOg != null) parts.push(`planerat ${sg(plannedOg)}`);
  if (s.fg_expected != null) parts.push(`förväntad FG ${sg(s.fg_expected)}`);
  if (!p?.at && !parts.length) return null;

  return (
    <div className="text-muted-foreground/70 truncate font-medium tabular-nums" style={{ fontSize: "11px", letterSpacing: "0.02em" }}>
      {p?.at && (
        <p className="truncate">
          Pitchad {fmtTime(p.at)}
          {p.amount != null && ` · ${p.amount} ${p.amount_unit ?? ""}${p.form ? ` ${p.form}` : ""}`}
          {p.yeast_temp_c != null && ` vid ${p.yeast_temp_c}°`}
        </p>
      )}
      {parts.length > 0 && <p className="truncate">{parts.join(" · ")}</p>}
    </div>
  );
}
