import { BrewData } from "@/types/brew";
import { StatCard } from "./StatCard";

interface GravityStatProps {
  brew: BrewData;
  updatedFields: Record<string, Record<string, boolean>>;
}

export function GravityStat({ brew, updatedFields }: GravityStatProps) {
  const color = brew.coldcrashAcknowledged 
    ? 'hsl(120 50% 45%)' 
    : 'hsl(var(--primary))';
  
  const customBackground = brew.coldcrashAcknowledged 
    ? 'linear-gradient(135deg, hsl(120 50% 20% / 0.15) 0%, hsl(120 40% 15% / 0.1) 100%)'
    : 'linear-gradient(135deg, hsl(38 90% 60% / 0.08) 0%, hsl(222 18% 15% / 0.6) 100%)';

  return (
    <StatCard
      label="Gravity"
      value={<span className="tabular-nums">{brew.currentSG.toFixed(3)}</span>}
      color={color}
      isUpdated={updatedFields[brew.batch_id]?.sg}
      centered
      rowSpan={2}
      customBackground={customBackground}
      labelSize="max(12px, min(2.2vh, 1.5vw))"
      valueSize="max(32px, min(6vh, 3vw))"
      className="gap-0.5"
    >
      <div className="text-muted-foreground/70 mt-0.5 space-y-0.5 z-10 text-center px-1 w-full">
        <p className="tabular-nums truncate" style={{ fontSize: 'max(10px, min(1.5vh, 1.1vw))' }}>
          OG: {brew.originalGravity.toFixed(3)}
        </p>
        <p className="tabular-nums truncate" style={{ fontSize: 'max(10px, min(1.5vh, 1.1vw))' }}>
          FG: {brew.finalGravity.toFixed(3)}
        </p>
        <p className="font-medium truncate" style={{ fontSize: 'max(10px, min(1.5vh, 1.1vw))' }}>
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
