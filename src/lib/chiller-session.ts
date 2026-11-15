import { stockholmFormat } from "@/lib/stockholm-time";

export type ChillerChart = {
  series: [number, number | null, number | null, number | null][];
  runs: [number, number][];
  lift?: [number, number][];
  lift_base?: [number, number][];
};

export interface ChillerSession {
  chart: ChillerChart | null;
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

export const chartClock = (startedAt: string, seconds: number) => fmtEta(new Date(Date.parse(startedAt) + seconds * 1000).toISOString());
export const chartTicks = ([min, max]: [number, number], count = 4) => Array.from({ length: count }, (_, i) => min + (max - min) * i / (count - 1));
export const chartScale = (value: number, [min, max]: [number, number], from: number, to: number) => from + (value - min) / (max - min) * (to - from);
export const chartLines = (chart: ChillerChart) => ([1, 2, 3] as const).filter((index) => chart.series.some((p) => p[index] != null));
export function bathChartDomains(chart: ChillerChart, stop: number | null): { time: [number, number]; temperature: [number, number] } {
  const times = chart.series.map((p) => p[0]);
  const values = chart.series.flatMap((p) => p.slice(1).filter((v): v is number => v != null));
  if (stop != null) values.push(stop);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const pad = Math.max((max - min) * 0.08, 0.5);
  const start = times.length ? Math.min(...times) : 0;
  return { time: [start, Math.max(start + 1, ...times)], temperature: [min - pad, max + pad] };
}
export function liftChartDomains(chart: ChillerChart, bathFrom: number | null): { degrees: [number, number]; heat: [number, number]; ticks: number[] } {
  const points = [...(chart.lift ?? []), ...(chart.lift_base ?? [])];
  const top = Math.max(12, Math.ceil(Math.max(bathFrom ?? 0, ...points.map((p) => p[0]))));
  return {
    degrees: [top, 0], heat: [0, Math.max(1, ...points.map((p) => p[1])) * 1.15],
    ticks: Array.from({ length: Math.floor(top / 2) + 1 }, (_, i) => Math.floor(top / 2) * 2 - i * 2),
  };
}
export const showLiftChart = (s: ChillerSession, compact = false) => !compact && s.kind === "test" && !!s.chart && (s.active || (s.chart.lift?.length ?? 0) > 0);

/** Null observations start a new segment, never bridge a missing sensor reading. */
export function chartPath(points: [number, number | null][], x: (v: number) => number, y: (v: number) => number): string {
  let penDown = false;
  return points.map(([a, b]) => {
    if (b == null) { penDown = false; return ""; }
    const command = penDown ? "L" : "M";
    penDown = true;
    return `${command}${x(a)},${y(b)}`;
  }).join(" ");
}
