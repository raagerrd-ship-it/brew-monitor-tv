import { memo } from "react";
import { BrewData } from "@/types/brew";
import { StatCard } from "./StatCard";

interface GravityStatProps {
  brew: BrewData;
  updatedFields: Record<string, Record<string, boolean>>;
  onSyncedDataClick?: () => void;
}

function GravityStatComponent({ brew, updatedFields, onSyncedDataClick }: GravityStatProps) {
  const isCustomBrew = brew.batch_id.startsWith('custom_');
  const color = brew.coldcrashAcknowledged 
    ? 'hsl(120 50% 45%)' 
    : 'hsl(var(--primary))';
  
  const customBackground = brew.coldcrashAcknowledged 
    ? 'linear-gradient(135deg, hsl(120 50% 20% / 0.15) 0%, hsl(120 40% 15% / 0.1) 100%)'
    : 'linear-gradient(135deg, hsl(38 90% 60% / 0.08) 0%, hsl(222 18% 15% / 0.6) 100%)';

  // Split gravity into main (3 decimals) and 4th decimal
  const sgString = brew.currentSG.toFixed(4);
  const mainPart = sgString.slice(0, -1); // e.g., "1.012"
  const fourthDecimal = sgString.slice(-1); // e.g., "3"

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
      labelSize="max(14px, min(2.5vh, 1.6vw))"
      valueSize="max(32px, min(6vh, 3vw))"
      className="gap-0.5"
      clickable={isCustomBrew && !!onSyncedDataClick}
      onClick={isCustomBrew ? onSyncedDataClick : undefined}
      title={isCustomBrew ? "Visa synkad data" : undefined}
    >
      <div className="text-muted-foreground/70 z-10 text-center px-1 w-full flex flex-col min-h-0">
        <p className="tabular-nums truncate leading-tight" style={{ fontSize: 'max(11px, min(1.6vh, 1.1vw))' }}>
          OG: {brew.originalGravity.toFixed(3)}
        </p>
        <p className="tabular-nums truncate leading-tight" style={{ fontSize: 'max(11px, min(1.6vh, 1.1vw))' }}>
          FG: {brew.finalGravity.toFixed(3)}
        </p>
        <p className="font-medium truncate leading-tight" style={{ fontSize: 'max(11px, min(1.6vh, 1.1vw))' }}>
          {brew.fermentationRate !== null ? (
            <>{brew.fermentationRate > 0 ? '-' : '+'}{Math.abs(brew.fermentationRate).toFixed(3)}/dygn</>
          ) : (
            <>Beräknar...</>
          )}
        </p>
      </div>
    </StatCard>
  );
}

export const GravityStat = memo(GravityStatComponent);
