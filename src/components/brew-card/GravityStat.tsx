import { memo, useMemo } from "react";
import { BrewData } from "@/types/brew";
import { StatCard } from "./StatCard";
import { useTvMode } from "@/contexts/TvModeContext";

interface GravityStatProps {
  brew: BrewData;
  updatedFields: Record<string, Record<string, boolean>>;
  onSyncedDataClick?: () => void;
}

function GravityStatComponent({ brew, updatedFields, onSyncedDataClick }: GravityStatProps) {
  const { isTvMode } = useTvMode();
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

  const sgString = brew.currentSG.toFixed(4);
  const mainPart = sgString.slice(0, -1);
  const fourthDecimal = sgString.slice(-1);

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
      value={
        <span className="tabular-nums">
          {mainPart}
          <span className="text-muted-foreground/40">{fourthDecimal}</span>
        </span>
      }
      color={color}
      isUpdated={updatedFields[brew.batch_id]?.sg}
      centered
      rowSpan={2}
      customBackground={customBackground}
      labelSize="18px"
      valueSize="48px"
      className="gap-0.5"
      clickable={isCustomBrew && !!onSyncedDataClick}
      onClick={isCustomBrew ? onSyncedDataClick : undefined}
      title={isCustomBrew ? "Visa synkad data" : undefined}
    >
      <div className="z-10 text-center px-2 w-full flex flex-col min-h-0 gap-1 mt-1">
        {/* Progress bar */}
        <div className="w-full px-1">
          <div 
            className="w-full rounded-full overflow-hidden relative"
            style={{ 
              height: isTvMode ? '6px' : '12px',
              background: 'hsl(0 0% 0% / 0.5)',
              boxShadow: 'inset 0 2px 4px hsl(0 0% 0% / 0.6), inset 0 -1px 0 hsl(0 0% 100% / 0.05)'
            }}
          >
            <div 
              className={`h-full rounded-full ${isTvMode ? '' : 'transition-all duration-700 ease-out'}`}
              style={{ 
                width: `${progress}%`,
                background: progressColor,
                boxShadow: `0 0 12px ${progressColor}, 0 0 6px ${progressColor}`
              }}
            />
            <div 
              className="absolute inset-0 rounded-full pointer-events-none"
              style={{
                background: 'linear-gradient(180deg, hsl(0 0% 100% / 0.2) 0%, transparent 40%)'
              }}
            />
          </div>
        </div>
        
        {/* OG and FG labels */}
        <div 
          className="flex justify-between text-muted-foreground/60 tabular-nums" 
          style={{ fontSize: isTvMode ? '7px' : '11px' }}
        >
          <span>{brew.originalGravity.toFixed(3)}</span>
          <span className="text-muted-foreground/40">{progress.toFixed(0)}%</span>
          <span>{brew.finalGravity.toFixed(3)}</span>
        </div>
        
        {/* Fermentation rate */}
        {!isInactive && (
          <p 
            className="font-medium text-muted-foreground/70 truncate leading-tight" 
            style={{ fontSize: isTvMode ? '8px' : '12px' }}
          >
            {brew.fermentationRate !== null ? (
              <>{brew.fermentationRate > 0 ? '-' : '+'}{Math.abs(brew.fermentationRate).toFixed(3)}/dygn</>
            ) : (
              <>Beräknar...</>
            )}
          </p>
        )}
      </div>
    </StatCard>
  );
}

export const GravityStat = memo(GravityStatComponent);
