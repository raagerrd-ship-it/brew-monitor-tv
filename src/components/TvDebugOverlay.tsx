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

export const TvDebugOverlay = memo(function TvDebugOverlay() {
  const entries = useSyncExternalStore(subscribeTvDebug, getTvDebugEntries);

  return createPortal(
    <div
      style={{
        position: 'fixed',
        bottom: 8,
        right: 8,
        width: 420,
        maxHeight: 320,
        overflow: 'hidden',
        background: 'rgba(0,0,0,0.8)',
        borderRadius: 8,
        padding: '6px 8px',
        zIndex: 99999,
        fontFamily: 'monospace',
        fontSize: 11,
        lineHeight: 1.4,
        color: '#e2e8f0',
        pointerEvents: 'none',
        border: '1px solid rgba(255,255,255,0.15)',
      }}
    >
      <div style={{ color: '#94a3b8', marginBottom: 2, fontSize: 10, fontWeight: 600, letterSpacing: 1 }}>
        TV DEBUG {entries.length === 0 && '(waiting for events…)'}
      </div>
      {entries.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column-reverse' }}>
          {[...entries].reverse().map((entry, i) => (
            <div key={`${entry.ts}-${i}`} style={{ opacity: i < 3 ? 1 : 0.6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              <span style={{ color: '#64748b' }}>{formatTime(entry.ts)}</span>
              {' '}
              <span>{categoryLabels[entry.category]}</span>
              {' '}
              <span style={{ color: categoryColors[entry.category] }}>{entry.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>,
    document.body
  );
});
