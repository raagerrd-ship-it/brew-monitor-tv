import { Hand, Power } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";

interface PiOverrideBoxProps {
  source: 'manual' | 'off';
  effectiveTarget: number | null;
  pausedAt: string | null;
  profileName: string;
  stepLabel?: string | null;
}

/** Ersätter profilrutan när Pi:n rapporterar manuellt mål eller avstängd tank. */
export function PiOverrideBox({ source, effectiveTarget, pausedAt, profileName, stepLabel }: PiOverrideBoxProps) {
  const isOff = source === 'off';
  const accent = isOff ? 'hsl(0 72% 55%)' : 'hsl(38 92% 55%)';
  const Icon = isOff ? Power : Hand;

  return (
    <div
      className="relative flex items-center gap-2.5 px-3 py-2.5 rounded-lg overflow-hidden backdrop-blur-md transition-all duration-300"
      style={{
        background: `linear-gradient(145deg, ${accent} / 0.12, hsl(222 20% 12% / 0.7))`,
        border: `1px solid ${accent}`,
        boxShadow: `0 0 18px ${accent}33, inset 0 1px 0 hsl(0 0% 100% / 0.08)`,
        minHeight: '72px',
        opacity: isOff ? 0.85 : 1,
      }}
    >
      <div
        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center"
        style={{ background: `${accent}26`, border: `1px solid ${accent}` }}
      >
        <Icon className="h-4 w-4" style={{ color: accent }} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="font-bold tracking-tight truncate" style={{ fontSize: '14px', color: accent }}>
          {isOff
            ? 'AVSTÄNGD'
            : `MANUELLT ${effectiveTarget != null ? effectiveTarget.toFixed(1) : '—'}°`}
        </div>
        <div className="text-xs text-muted-foreground truncate mt-0.5">
          {profileName}
          {stepLabel ? ` · ${stepLabel}` : ''} pausad
          {pausedAt ? ` ${formatDistanceToNow(new Date(pausedAt), { addSuffix: true, locale: sv })}` : ''}
        </div>
      </div>
    </div>
  );
}
