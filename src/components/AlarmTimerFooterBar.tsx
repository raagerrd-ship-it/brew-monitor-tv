import { memo } from 'react';
import { X } from 'lucide-react';
import type { AlarmTimerEntry } from '@/contexts/AlarmTimerContext';

interface Props {
  entry: AlarmTimerEntry;
  remainingMs: number;
  onCancel: () => void;
}

function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatEndTime(epoch: number): string {
  return new Date(epoch).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}

export const AlarmTimerFooterBar = memo(function AlarmTimerFooterBar({ entry, remainingMs, onCancel }: Props) {
  const progress = entry.totalMs > 0 ? Math.max(0, Math.min(100, ((entry.totalMs - remainingMs) / entry.totalMs) * 100)) : 0;

  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-20 backdrop-blur-xl flex items-center px-4 gap-3"
      style={{
        height: '48px',
        background: 'linear-gradient(145deg, hsl(38 80% 15% / 0.6) 0%, hsl(222 20% 12% / 0.8) 100%)',
        borderTop: '1px solid hsl(38 60% 30% / 0.2)',
        boxShadow: '0 -4px 16px hsl(222 30% 3% / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.06)',
      }}
    >
      {/* Left: countdown */}
      <div className="flex items-center flex-shrink-0">
        <span className="font-bold tabular-nums text-base" style={{ color: 'hsl(38 90% 70%)' }}>
          {formatCountdown(remainingMs)}
        </span>
      </div>

      {/* Center: progress bar */}
      <div className="flex-1 relative rounded-full overflow-hidden" style={{
        height: '8px',
        background: 'hsl(0 0% 0% / 0.4)',
        boxShadow: 'inset 0 1px 3px hsl(0 0% 0% / 0.5)',
      }}>
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
          style={{
            width: `${progress}%`,
            background: 'linear-gradient(90deg, hsl(38 80% 45%), hsl(45 95% 55%))',
            boxShadow: '0 0 8px hsl(38 90% 55% / 0.5)',
          }}
        />
        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{ background: 'linear-gradient(180deg, hsl(0 0% 100% / 0.15) 0%, transparent 50%)' }}
        />
      </div>

      {/* Right: label + cancel */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-sm font-medium truncate max-w-[160px]" style={{ color: 'hsl(40 10% 80%)' }}>
          {entry.type === 'alarm' ? `${entry.label} ${formatEndTime(entry.endsAt)}` : entry.label}
        </span>
        <button
          onClick={onCancel}
          className="p-1 rounded-full opacity-50 hover:opacity-100 transition-opacity"
          title="Avbryt"
        >
          <X className="w-4 h-4" style={{ color: 'hsl(0 0% 70%)' }} />
        </button>
      </div>
    </div>
  );
});
