import { memo, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { getTvDebugEntries, subscribeTvDebug, TvDebugEntry } from '@/lib/tv-debug-log';

const categoryColors: Record<TvDebugEntry['category'], string> = {
  sonos: '#4ade80',
  chart: '#60a5fa',
  bg: '#f59e0b',
};

const categoryLabels: Record<TvDebugEntry['category'], string> = {
  sonos: '♫',
  chart: '📊',
  bg: '🖼️',
};

function formatTime(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function formatElapsed(ms: number | null): string {
  if (ms === null) return '';
  if (ms < 1000) return `+${ms}ms`;
  return `+${(ms / 1000).toFixed(1)}s`;
}

export const TvDebugOverlay = memo(function TvDebugOverlay() {
  const entries = useSyncExternalStore(subscribeTvDebug, getTvDebugEntries);

  return createPortal(
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        right: 0,
        width: '100vw',
        maxHeight: '50vh',
        overflow: 'hidden',
        background: 'rgba(0,0,0,0.9)',
        padding: '12px 16px',
        zIndex: 99999,
        fontFamily: 'monospace',
        fontSize: 18,
        lineHeight: 1.5,
        color: '#e2e8f0',
        pointerEvents: 'none',
      }}
    >
      <div style={{ color: '#94a3b8', marginBottom: 4, fontSize: 14, fontWeight: 600, letterSpacing: 1 }}>
        TV DEBUG {entries.length === 0 && '(waiting for events…)'}
      </div>
      {entries.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column-reverse' }}>
          {[...entries].reverse().map((entry, i) => (
            <div key={`${entry.ts}-${i}`} style={{ opacity: i < 3 ? 1 : 0.6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', gap: 4 }}>
              <span style={{ color: '#64748b', flexShrink: 0 }}>{formatTime(entry.ts)}</span>
              <span style={{ flexShrink: 0 }}>{categoryLabels[entry.category]}</span>
              <span style={{ color: categoryColors[entry.category], flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.message}</span>
              {entry.elapsed !== null && (
                <span style={{ color: '#a78bfa', flexShrink: 0, fontSize: 16 }}>{formatElapsed(entry.elapsed)}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>,
    document.body
  );
});
