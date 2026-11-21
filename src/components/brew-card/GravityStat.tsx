import { memo, useMemo } from "react";
import { BrewData } from "@/types/brew";
import { StatCard, MiniBar, statDetailClass } from "./StatCard";
import { RollingNumber } from "@/components/RollingNumber";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tv-tooltip";

const STALL_THRESHOLD = 0.002;

const phaseLabels: Record<string, string> = {
  lag: 'Lagfas',
  exponential: 'Exponentiell',
  declining: 'Avtagande',
  stationary: 'Stationär',
};

const phaseDescriptions: Record<string, string> = {
  lag: '⏳ Lagfas — jästen anpassar sig, ingen märkbar SG-förändring ännu',
  exponential: '🚀 Exponentiell — jäsningen är som mest aktiv',
  declining: '↘ Avtagande — jäsningen saktar ner, närmar sig slutet',
  stationary: '⏳ Stationär — minimal aktivitet, SG stabil',
};

interface GravityStatProps {
  brew: BrewData;
  updatedFields: Record<string, Record<string, boolean>>;
  onSyncedDataClick?: () => void;
  hideReadyToCrash?: boolean;
  compact?: boolean;
}

function FermentationRateLine({ rate, trend, stallThreshold, rate6h, rate12h }: { 
  rate: number; 
  trend?: 'rising' | 'falling' | 'stable' | null;
  stallThreshold: number;
  rate6h?: number | null;
  rate12h?: number | null;
}) {
  const shownRate = rate6h ?? rate;
  const isStalled = rate <= stallThreshold;
  const arrow = trend === 'rising' ? '↗' : trend === 'falling' ? '↘' : '→';
  const rateText = `${shownRate > 0 ? '−' : '+'}${Math.abs(shownRate).toFixed(3).replace('.', ',')}/dygn`;

  const tooltipLines = [
    `Fart (24h): ${rate > 0 ? '-' : '+'}${Math.abs(rate).toFixed(4)}/d`,
    rate6h != null ? `Senaste 6h: ${rate6h > 0 ? '-' : '+'}${Math.abs(rate6h).toFixed(4)}/d` : null,
    rate12h != null ? `Föregående 6h: ${rate12h > 0 ? '-' : '+'}${Math.abs(rate12h).toFixed(4)}/d` : null,
    rate6h != null && rate12h != null ? `Δ: ${(rate6h - rate12h) > 0 ? '+' : ''}${(rate6h - rate12h).toFixed(4)}/d` : null,
  ].filter(Boolean).join('\n');

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={`${statDetailClass} cursor-help`} style={isStalled ? { color: 'hsl(var(--destructive))' } : undefined}>
            {isStalled ? <span className="font-semibold">{arrow} Avstannat</span> : <span>{arrow} {rateText}</span>}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="whitespace-pre text-xs tabular-nums">
          {tooltipLines}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function GravityStatComponent({ brew, updatedFields, onSyncedDataClick, hideReadyToCrash, compact = false }: GravityStatProps) {
  const stallThreshold = STALL_THRESHOLD;
  const isCustomBrew = brew.batch_id.startsWith('custom_');
  const isColdcrash = brew.coldcrashAcknowledged;
  const isInactive = brew.status === "Konditionering" || brew.status === "Klar";
  
  const color = isColdcrash 
    ? 'hsl(120 50% 45%)' 
    : 'hsl(var(--primary))';
  
  const progressColor = isColdcrash 
    ? 'hsl(120 50% 45%)' 
    : 'hsl(38 90% 50%)';
  
  const customBackground = isColdcrash 
    ? 'linear-gradient(135deg, hsl(120 50% 20% / 0.15) 0%, hsl(120 40% 15% / 0.1) 100%)'
    : 'linear-gradient(135deg, hsl(38 90% 60% / 0.08) 0%, hsl(222 18% 15% / 0.6) 100%)';

  const progress = useMemo(() => {
    const range = brew.originalGravity - brew.finalGravity;
    if (range <= 0) return 0;
    const current = brew.originalGravity - brew.currentSG;
    const pct = (current / range) * 100;
    return Math.max(0, Math.min(100, pct));
  }, [brew.originalGravity, brew.finalGravity, brew.currentSG]);

  return (
    <StatCard
      label="Gravity"
      value={<RollingNumber value={brew.currentSG} decimals={4} mutedLastDigit />}
      color={color}
      isUpdated={updatedFields[brew.batch_id]?.sg}
      
      rowSpan={2}
      customBackground={customBackground}
      labelSize="18px"
      valueSize={compact ? "26px" : "48px"}
      className="gap-0.5 !py-1.5 !px-1.5"
      clickable={isCustomBrew && !!onSyncedDataClick}
      onClick={isCustomBrew ? onSyncedDataClick : undefined}
      title={isCustomBrew ? "Visa synkad data" : undefined}
    >
      {!compact && <div className="z-10 w-full flex flex-col min-h-0 gap-[3px]">
        <div className={statDetailClass}>
          <span>{`OG\u202F${brew.originalGravity.toFixed(3)}`}</span>
          <span>{`FG\u202F${brew.finalGravity.toFixed(3)}`}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex-1"><MiniBar to={progress} color={progressColor} /></div>
          <span className="text-[12px] font-semibold tabular-nums leading-none text-foreground whitespace-nowrap">{progress.toFixed(0)} %</span>
        </div>
        {!isInactive && brew.fermentationRate !== null && (
          <FermentationRateLine 
            rate={brew.fermentationRate} 
            trend={brew.fermentationTrend?.trend}
            stallThreshold={stallThreshold}
            rate6h={brew.fermentationTrend?.rate6h}
            rate12h={brew.fermentationTrend?.rate12h}
          />
        )}
        {!isInactive && brew.fermentationRate === null && (
          <p className={statDetailClass}>Beräknar...</p>
        )}
        {!isInactive && brew.fermentationMetrics && (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className={`${statDetailClass} hidden sm:flex cursor-help h-[1em] overflow-hidden`}>
                  <span>{brew.fermentationMetrics.activity_score == null ? 'Pillen tyst' : `Aktivitet ${brew.fermentationMetrics.activity_score} %`}</span>
                  {brew.fermentationRate !== null && brew.fermentationRate > stallThreshold && (
                    <span>{phaseLabels[brew.fermentationMetrics.fermentation_phase] ?? brew.fermentationMetrics.fermentation_phase}</span>
                  )}
                  {brew.fermentationMetrics.ready_to_crash && !hideReadyToCrash && (
                    <span className="text-blue-400 font-semibold">🧊 Redo</span>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs max-w-[220px]">
                <p className="font-semibold mb-1">
                  {phaseDescriptions[brew.fermentationMetrics.fermentation_phase] ?? 'Okänd fas'}
                </p>
                <p>⚡ Aktivitet: {brew.fermentationMetrics.activity_score == null ? 'pillen tyst' : `${brew.fermentationMetrics.activity_score}%`} — mått på hur aktiv jäsningen är just nu (0–100%)</p>
                {brew.fermentationMetrics.ready_to_crash && !hideReadyToCrash && (
                  <p className="mt-1">🧊 SG stabil + hög utjäsningsgrad → redo för coldcrash</p>
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>}
    </StatCard>
  );
}

export const GravityStat = memo(GravityStatComponent);
