/**
 * Global TV debug log — push events from anywhere, overlay reads them.
 * Only active when ?tv=true is in the URL.
 */

export interface TvDebugEntry {
  ts: number;
  category: 'sonos' | 'chart' | 'bg';
  message: string;
}

const MAX_ENTRIES = 40;
const entries: TvDebugEntry[] = [];
const listeners = new Set<() => void>();

export function tvDebug(category: TvDebugEntry['category'], message: string) {
  const entry: TvDebugEntry = { ts: Date.now(), category, message };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  listeners.forEach(fn => fn());
}

export function getTvDebugEntries(): readonly TvDebugEntry[] {
  return entries;
}

export function subscribeTvDebug(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
