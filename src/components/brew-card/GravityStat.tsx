import { memo, useMemo, useState, useEffect } from "react";
import { BrewData } from "@/types/brew";
import { StatCard } from "./StatCard";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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

function FermentationRateBar({ rate, trend, stallThreshold, rate6h, rate12h }: { 
  rate: number; 
  trend?: 'rising' | 'falling' | 'stable' | null;
  stallThreshold: number;
  rate6h?: number | null;
  rate12h?: number | null;
}) {
  const displayRate = rate6h ?? rate;
  const previousRate = rate12h ?? displayRate;
  const maxRate = Math.max(0.015, displayRate * 1.5, previousRate * 1.5);
  const stallPct = (stallThreshold / maxRate) * 100;
  const ratePct = Math.min((displayRate / maxRate) * 100, 100);
  
  const trendIcon = trend === 'rising' ? '▶' : trend === 'falling' ? '◀' : '•';
  const trendColor = trend === 'rising' 
    ? 'hsl(142 70% 50%)' 
    : trend === 'falling' 
      ? 'hsl(0 70% 55%)' 
      : 'hsl(38 70% 50%)';

  const isStalled = rate <= stallThreshold;

  // Trend bar: visualisera skillnaden mellan föregående 6h och senaste 6h
  let trendBarLeft = ratePct;
  let trendBarWidth = 0;
  if (rate6h != null && rate12h != null && rate6h > 0 && rate12h > 0) {
    const previousPct = Math.min((rate12h / maxRate) * 100, 100);
    trendBarLeft = Math.min(ratePct, previousPct);
    trendBarWidth = Math.abs(ratePct - previousPct);
  }

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
          <div className="w-full flex flex-col gap-0.5 cursor-help">
            {/* Bar */}
            <div className="relative w-full px-1" style={{ height: '6px' }}>
              <div 
                className="absolute inset-0 rounded-full overflow-hidden"
                style={{ 
                  background: 'hsl(0 0% 0% / 0.5)',
                  boxShadow: 'inset 0 2px 4px hsl(0 0% 0% / 0.6), inset 0 -1px 0 hsl(0 0% 100% / 0.05)'
                }}
              >
                <div 
                  className="absolute top-0 bottom-0 left-0"
                  style={{ 
                    width: `${stallPct}%`,
                    background: 'linear-gradient(90deg, hsl(0 70% 35%), hsl(25 80% 40%))',
                    opacity: 0.7,
                  }}
                />
                {trendBarWidth > 0.5 && (
                  <div 
                    className="absolute top-0 bottom-0"
                    style={{ 
                      left: `${trendBarLeft}%`,
                      width: `${trendBarWidth}%`,
                      background: trendColor,
                      opacity: 0.6,
                      boxShadow: `0 0 6px ${trendColor}`,
                    }}
                  />
                )}
                <div 
                  className="absolute inset-0 rounded-full pointer-events-none"
                  style={{
                    background: 'linear-gradient(180deg, hsl(0 0% 100% / 0.2) 0%, transparent 40%)'
                  }}
                />
              </div>
              <div 
                className="absolute top-[-1px] bottom-[-1px] w-[2px] rounded-full"
                style={{ 
                  left: `${ratePct}%`,
                  background: isStalled ? 'hsl(0 70% 55%)' : 'hsl(0 0% 95%)',
                  boxShadow: `0 0 4px ${isStalled ? 'hsl(0 70% 55%)' : 'hsl(0 0% 100% / 0.6)'}`,
                }}
              />
            </div>
            {/* Scale labels */}
            <div 
              className="flex justify-between items-center text-muted-foreground/60 tabular-nums" 
              style={{ fontSize: '9px' }}
            >
              <span>0.000</span>
              <span style={{ color: trendColor, fontSize: '10px' }}>{trendIcon}</span>
              <span>{maxRate.toFixed(3)}</span>
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="whitespace-pre text-xs tabular-nums">
          {tooltipLines}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
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
            rate6h={brew.fermentationTrend?.rate6h}
            rate12h={brew.fermentationTrend?.rate12h}
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
