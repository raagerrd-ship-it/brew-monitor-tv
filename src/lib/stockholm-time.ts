// En tidszon för all visning: alltid svensk tid, oavsett enhetens tidszon (Chromecast kan stå i UTC).
export const STOCKHOLM_TZ = 'Europe/Stockholm';

export const formatStockholm = (d: Date | number | string, opts: Intl.DateTimeFormatOptions) =>
  new Date(d).toLocaleString('sv-SE', { ...opts, timeZone: STOCKHOLM_TZ });

export const stockholmFormat = (opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('sv-SE', { ...opts, timeZone: STOCKHOLM_TZ });

const PARTS = stockholmFormat({ year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });

/** Datum/klockdelar i svensk tid. month är 1–12. */
export function stockholmParts(ts: number) {
  const p = Object.fromEntries(PARTS.formatToParts(new Date(ts)).map((x) => [x.type, Number(x.value)]));
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second };
}

/** Svensk midnatt för dagen `ts` ligger i, förskjuten `addDays` dagar. */
export function stockholmMidnight(ts: number, addDays = 0): number {
  const { year, month, day } = stockholmParts(ts);
  const guess = Date.UTC(year, month - 1, day + addDays);
  const q = stockholmParts(guess);
  const offset = Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute, q.second) - guess;
  return guess - offset;
}
