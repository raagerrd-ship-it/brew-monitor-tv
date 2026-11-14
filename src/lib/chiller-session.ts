import { stockholmFormat } from "@/lib/stockholm-time";

export interface ChillerSession {
  kind: string | null;
  active: boolean;
  level: string | null;
  advice: string | null;
  started_at: string | null;
  ends_by: string | null;
  ended_at: string | null;
  bath_c: number | null;
  bath_from_c: number | null;
  stop_c: number | null;
  rate_c_min: number | null;
  eta_at: string | null;
  compressor_on: boolean;
  after_runs_done: number | null;
  lift_pct: number | null;
  result: string | null;
  chiller_locked: boolean;
  warnings: string[];
  sent_at: string | null;
  updated_at: string;
}

export const ACTIVE_STALE_MS = 5 * 60_000;
export const ENDED_SHOW_MS = 60 * 60_000;

/** Om kortet ska visas nu, och när svaret nästa gång kan ändras (ms-tidpunkt eller null). */
export function chillerVisibility(s: ChillerSession | null, now: number): { visible: boolean; changeAt: number | null } {
  if (!s) return { visible: false, changeAt: null };
  if (Array.isArray(s.warnings) && s.warnings.length > 0) return { visible: true, changeAt: null };
  if (s.active) {
    const until = Date.parse(s.updated_at) + ACTIVE_STALE_MS;
    return until > now ? { visible: true, changeAt: until } : { visible: false, changeAt: null };
  }
  if (s.ended_at) {
    const until = Date.parse(s.ended_at) + ENDED_SHOW_MS;
    return until > now ? { visible: true, changeAt: until } : { visible: false, changeAt: null };
  }
  return { visible: false, changeAt: null };
}

export const chillerTitle = (kind: string | null) =>
  kind === "test" ? "Gastest" : kind === "refill" ? "Påfyllning" : kind === "top" ? "Toppning" : "Glykolkylaren";

export const LEVEL_LABEL: Record<string, string> = {
  wait: "Mäter", rest: "Vilar", fill: "Fyll nu", check: "Kontrollera", stop: "Sluta", done: "Klart",
};

/** En decimal, svenskt decimalkomma (minus som −). */
export const fmtC = (v: number) => v.toFixed(1).replace(".", ",").replace("-", "−");
/** Mål: hela grader utan decimal, annars en decimal (som bryggdagskortets målgrader). */
export const fmtTarget = (v: number) => fmtC(v).replace(/,0$/, "");
export const fmtRate = (v: number) => `${v.toFixed(2).replace(".", ",").replace("-", "−")} °/min`;
const HM = stockholmFormat({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export const fmtEta = (iso: string) => HM.format(new Date(iso));
