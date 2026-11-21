import { memo, useMemo } from "react";
import { BrewData } from "@/types/brew";
import { StatCard, MiniBar, statDetailClass } from "./StatCard";
import { RollingNumber } from "@/components/RollingNumber";

const STALL_THRESHOLD = 0.002;



interface GravityStatProps {
  brew: BrewData;
  updatedFields: Record<string, Record<string, boolean>>;
  onSyncedDataClick?: () => void;
  hideReadyToCrash?: boolean;
  compact?: boolean;
}

function FermentationRateLine({ rate, trend, stallThreshold, rate6h, activity, ready }: { 
  rate: number; 
  trend?: 'rising' | 'falling' | 'stable' | null;
  stallThreshold: number;
  rate6h?: number | null;
  activity?: number | null;
  ready?: boolean;
}) {
  const shownRate = rate6h ?? rate;
  const isStalled = rate <= stallThreshold;
  const arrow = trend === 'rising' ? '↗' : trend === 'falling' ? '↘' : '→';
  const parts = isStalled
    ? []
    : [`${arrow} ${shownRate > 0 ? '−' : '+'}${Math.abs(shownRate).toFixed(3).replace('.', ',')}/dygn`, activity != null ? `aktivitet ${activity} %` : null].filter(Boolean);
  return (
    <p className="text-[12px] leading-tight tabular-nums text-muted-foreground/80">
      {isStalled ? <span className="font-semibold" style={{ color: 'hsl(var(--destructive))' }}>Avstannat</span> : parts.join(' · ')}
      {ready && <span className="text-blue-400 font-semibold"> · 🧊 Redo</span>}
    </p>
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
            activity={brew.fermentationMetrics?.activity_score}
            ready={!!brew.fermentationMetrics?.ready_to_crash && !hideReadyToCrash}
          />
        )}
        {!isInactive && brew.fermentationRate === null && (
          <p className={statDetailClass}>Beräknar...</p>
        )}
      </div>}
    </StatCard>
  );
}

export const GravityStat = memo(GravityStatComponent);
