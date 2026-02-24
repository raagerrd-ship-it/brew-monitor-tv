import { memo, useMemo, useState, useEffect } from "react";
import { BrewData } from "@/types/brew";
import { StatCard } from "./StatCard";
import { supabase } from "@/integrations/supabase/client";

const DEFAULT_STALL_THRESHOLD = 0.002;

// Cached module-level value to avoid re-fetching on every render
let cachedStallThreshold: number | null = null;

function useStallThreshold(): number {
  const [threshold, setThreshold] = useState(cachedStallThreshold ?? DEFAULT_STALL_THRESHOLD);

  useEffect(() => {
    if (cachedStallThreshold !== null) return;
    supabase
      .from('auto_cooling_settings')
      .select('stall_rate_threshold')
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data?.stall_rate_threshold != null) {
          cachedStallThreshold = Number(data.stall_rate_threshold);
          setThreshold(cachedStallThreshold);
        }
      });
  }, []);

  return threshold;
}

interface GravityStatProps {
  brew: BrewData;
  updatedFields: Record<string, Record<string, boolean>>;
  onSyncedDataClick?: () => void;
}

function FermentationRateBar({ rate, trend, stallThreshold }: { 
  rate: number; 
  trend?: 'rising' | 'falling' | 'stable' | null;
  stallThreshold: number;
}) {
  const maxRate = Math.max(0.015, rate * 1.5);
  const stallPct = (stallThreshold / maxRate) * 100;
  const ratePct = Math.min((rate / maxRate) * 100, 100);
  
  const trendIcon = trend === 'rising' ? '▲' : trend === 'falling' ? '▼' : '▶';
  const trendColor = trend === 'rising' 
    ? 'hsl(142 70% 50%)' 
    : trend === 'falling' 
      ? 'hsl(0 70% 55%)' 
      : 'hsl(38 70% 50%)';

  const isStalled = rate <= stallThreshold;

  return (
    <div className="w-full px-1 flex flex-col gap-0.5">
      {/* Bar */}
      <div className="relative w-full" style={{ height: '6px' }}>
        {/* Track */}
        <div 
          className="absolute inset-0 rounded-full overflow-hidden"
          style={{ 
            background: 'hsl(0 0% 0% / 0.5)',
            boxShadow: 'inset 0 2px 4px hsl(0 0% 0% / 0.6), inset 0 -1px 0 hsl(0 0% 100% / 0.05)'
          }}
        >
          {/* Stall zone (red gradient) */}
          <div 
            className="absolute top-0 bottom-0 left-0"
            style={{ 
              width: `${stallPct}%`,
              background: 'linear-gradient(90deg, hsl(0 70% 35%), hsl(25 80% 40%))',
              opacity: 0.7,
            }}
          />
          {/* Active zone fill */}
          {!isStalled && (
            <div 
              className="absolute top-0 bottom-0"
              style={{ 
                left: `${stallPct}%`,
                width: `${Math.max(0, ratePct - stallPct)}%`,
                background: 'hsl(38 90% 50%)',
                boxShadow: '0 0 8px hsl(38 90% 50% / 0.5)',
              }}
            />
          )}
          {/* Glass reflection */}
          <div 
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background: 'linear-gradient(180deg, hsl(0 0% 100% / 0.2) 0%, transparent 40%)'
            }}
          />
        </div>
        {/* Rate marker line */}
        <div 
          className="absolute top-[-1px] bottom-[-1px] w-[2px] rounded-full"
          style={{ 
            left: `${ratePct}%`,
            background: isStalled ? 'hsl(0 70% 55%)' : 'hsl(0 0% 95%)',
            boxShadow: `0 0 4px ${isStalled ? 'hsl(0 70% 55%)' : 'hsl(0 0% 100% / 0.6)'}`,
          }}
        />
      </div>
      {/* Labels */}
      <div 
        className="flex justify-between items-center text-muted-foreground/60 tabular-nums" 
        style={{ fontSize: '9px' }}
      >
        <span style={{ color: isStalled ? 'hsl(0 70% 55%)' : undefined }}>
          {isStalled ? 'STALL' : 'STALL'}
        </span>
        <span 
          className="font-medium flex items-center gap-0.5"
          style={{ color: trendColor, fontSize: '9px' }}
        >
          <span style={{ fontSize: '7px' }}>{trendIcon}</span>
          {rate > 0 ? '-' : '+'}{Math.abs(rate).toFixed(3)}/d
        </span>
      </div>
    </div>
  );
}

function GravityStatComponent({ brew, updatedFields, onSyncedDataClick }: GravityStatProps) {
  const stallThreshold = useStallThreshold();
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
      
      rowSpan={2}
      customBackground={customBackground}
      labelSize="18px"
      valueSize="48px"
      className="gap-0.5 !py-1.5"
      clickable={isCustomBrew && !!onSyncedDataClick}
      onClick={isCustomBrew ? onSyncedDataClick : undefined}
      title={isCustomBrew ? "Visa synkad data" : undefined}
    >
      <div className="z-10 text-center px-2 w-full flex flex-col min-h-0 gap-1 mt-1">
        {/* Gravity progress bar */}
        <div className="w-full px-1">
          <div 
            className="w-full rounded-full overflow-hidden relative"
            style={{ 
              height: '6px',
              background: 'hsl(0 0% 0% / 0.5)',
              boxShadow: 'inset 0 2px 4px hsl(0 0% 0% / 0.6), inset 0 -1px 0 hsl(0 0% 100% / 0.05)'
            }}
          >
            <div 
              className="h-full rounded-full"
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
          style={{ fontSize: '9px' }}
        >
          <span>{brew.originalGravity.toFixed(3)}</span>
          <span className="text-muted-foreground/40">{progress.toFixed(0)}%</span>
          <span>{brew.finalGravity.toFixed(3)}</span>
        </div>
        
        {/* Fermentation rate bar */}
        {!isInactive && brew.fermentationRate !== null && (
          <FermentationRateBar 
            rate={brew.fermentationRate} 
            trend={brew.fermentationTrend?.trend}
            stallThreshold={stallThreshold}
          />
        )}
        {!isInactive && brew.fermentationRate === null && (
          <p 
            className="font-medium text-muted-foreground/70 truncate leading-tight" 
            style={{ fontSize: '10px' }}
          >
            Beräknar...
          </p>
        )}
      </div>
    </StatCard>
  );
}

export const GravityStat = memo(GravityStatComponent);
