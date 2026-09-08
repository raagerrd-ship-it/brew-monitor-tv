// Jästinformation är obligatorisk för bryggder som lämnas över till Pi:n —
// utan temperaturbandet kan Pi:n inte varna eller reglera inom jästens spann.

export type Yeast = {
  name: string | null;
  lab: string | null;
  min_temp: number | null;
  max_temp: number | null;
  attenuation: number | null;
};

/** Tal ska vara tal. Tomt, gissning eller skräp blir null — aldrig 0. */
const num = (...vals: unknown[]): number | null => {
  for (const v of vals) {
    if (v == null || v === "") continue;
    const n = Number(v);
    if (!isNaN(n)) return n;
  }
  return null;
};

const str = (...vals: unknown[]): string | null => {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
};

export function normalizeYeasts(raw: unknown): Yeast[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((y: any) => ({
      name: str(y?.name, y?.product),
      lab: str(y?.lab, y?.laboratory),
      min_temp: num(y?.min_temp, y?.min_temp_c, y?.temp_min),
      max_temp: num(y?.max_temp, y?.max_temp_c, y?.temp_max),
      attenuation: num(y?.attenuation),
    }))
    .filter((y) => y.name !== null);
}
