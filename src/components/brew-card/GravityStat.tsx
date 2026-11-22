import { memo, useMemo } from "react";
import { BrewData } from "@/types/brew";
import { isPrePitch, toRatePct } from "./utils";
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

  // Farten som segmentets längd: var SG beräknas vara om 24 h (rate = SG-fall per dygn).
  const rate = brew.fermentationTrend?.rate6h ?? brew.fermentationRate;
  const prePitch = isPrePitch(brew);
  const isStalled = !isInactive && !prePitch && brew.fermentationRate !== null && brew.fermentationRate <= stallThreshold;
  const showRate = !isInactive && !prePitch && !isStalled && rate != null && rate > 0;
  const range = brew.originalGravity - brew.finalGravity;
  const projectedPct = showRate && range > 0 ? ((brew.originalGravity - (brew.currentSG - rate!)) / range) * 100 : progress;
  const ready = !isInactive && !!brew.fermentationMetrics?.ready_to_crash && !hideReadyToCrash;

  return (
    <StatCard
      label="Gravity"
      value={<RollingNumber value={brew.currentSG} decimals={4} mutedLastDigit />}
      color={color}
      isUpdated={updatedFields[brew.batch_id]?.sg}
      
      rowSpan={2}
      customBackground={customBackground}
      labelSize="18px"
      valueSize={compact ? "26px" : "46px"}
      className="gap-0.5 !py-1.5 !px-1.5 !justify-start"
      subValue={undefined}
      clickable={isCustomBrew && !!onSyncedDataClick}
      onClick={isCustomBrew ? onSyncedDataClick : undefined}
      title={isCustomBrew ? "Visa synkad data" : undefined}
    >
      {!compact && <div className="z-10 w-full flex flex-col min-h-0 gap-[3px] mt-auto">
        <MiniBar
          to={progress}
          color={prePitch ? 'hsl(var(--muted-foreground))' : progressColor}
          ghost={showRate ? [progress, projectedPct] : undefined}
          marker={isStalled ? progress : undefined}
          markerColor="hsl(var(--destructive))"
          under={showRate ? { pct: toRatePct(rate), color: 'hsl(var(--ferment-green))' } : undefined}
        />
        <div className={`${statDetailClass} !flex-nowrap`}>
          <span>{brew.originalGravity.toFixed(3)}</span>
          <span>{ready && '🧊 '}{brew.finalGravity.toFixed(3)}</span>
        </div>
      </div>}
    </StatCard>
  );
}

export const GravityStat = memo(GravityStatComponent);
