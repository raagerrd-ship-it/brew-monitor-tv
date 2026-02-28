/**
 * Global TV debug log — push events from anywhere, overlay reads them.
 * 
 * Elapsed is tracked per named flow: call tvDebug('chart', 'msg', 'chart-123')
 * to start a flow, then tvDebug('chart', 'done', 'chart-123') to show elapsed.
 */

export interface TvDebugEntry {
  ts: number;
  category: 'sonos' | 'bg';
  message: string;
  /** ms since flow started (same flowId), null if first event in flow */
  elapsed: number | null;
}

const MAX_ENTRIES = 40;
let entries: TvDebugEntry[] = [];
const listeners = new Set<() => void>();
const flowStarts: Record<string, number> = {};

/**
 * @param category - event category for color coding
 * @param message - display message
 * @param flowId - optional flow identifier. First call with a flowId sets t0, subsequent calls show elapsed since t0.
 */
export function tvDebug(category: TvDebugEntry['category'], message: string, flowId?: string) {
  const now = Date.now();
  let elapsed: number | null = null;

  if (flowId) {
    if (flowId in flowStarts) {
      elapsed = now - flowStarts[flowId];
      delete flowStarts[flowId]; // flow complete
    } else {
      flowStarts[flowId] = now; // flow start
    }
  }

  const entry: TvDebugEntry = { ts: now, category, message, elapsed };
  entries = [...entries, entry];
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  listeners.forEach(fn => fn());
}

export function getTvDebugEntries(): readonly TvDebugEntry[] {
  return entries;
}

export function subscribeTvDebug(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
