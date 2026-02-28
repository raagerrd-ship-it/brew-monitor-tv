/**
 * Global TV debug log — push events from anywhere, overlay reads them.
 * Only active when ?tv=true is in the URL.
 */

export interface TvDebugEntry {
  ts: number;
  category: 'sonos' | 'chart' | 'bg';
  message: string;
  /** ms since previous event in same category (auto-computed) */
  elapsed: number | null;
}

const MAX_ENTRIES = 40;
let entries: TvDebugEntry[] = [];
const listeners = new Set<() => void>();
const lastTs: Record<string, number> = {};
let version = 0;

export function tvDebug(category: TvDebugEntry['category'], message: string) {
  const now = Date.now();
  const prev = lastTs[category];
  const elapsed = prev ? now - prev : null;
  lastTs[category] = now;

  const entry: TvDebugEntry = { ts: now, category, message, elapsed };
  entries = [...entries, entry];
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  version++;
  listeners.forEach(fn => fn());
}

/** Returns a new snapshot reference each time entries change */
export function getTvDebugEntries(): readonly TvDebugEntry[] {
  return entries;
}

export function subscribeTvDebug(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
