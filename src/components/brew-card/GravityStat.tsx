import { BrewData } from "@/types/brew";

interface GravityStatProps {
  brew: BrewData;
  updatedFields: Record<string, Record<string, boolean>>;
}

export function GravityStat({ brew, updatedFields }: GravityStatProps) {
  const baseColor = brew.coldcrashAcknowledged 
    ? 'hsl(120 50% 45%)' 
    : 'hsl(var(--primary))';
  
  const baseStyles = brew.coldcrashAcknowledged 
    ? {
        background: 'linear-gradient(135deg, hsl(120 50% 20% / 0.15) 0%, hsl(120 40% 15% / 0.1) 100%)',
        borderColor: 'hsl(120 50% 45% / 0.3)',
      }
    : {
        background: 'linear-gradient(135deg, hsl(38 90% 60% / 0.08) 0%, hsl(222 18% 15% / 0.6) 100%)',
        borderColor: 'hsl(var(--primary) / 0.2)',
      };

  return (
    <div 
      className={`col-span-1 row-span-2 rounded-xl p-1 flex flex-col items-center justify-center gap-0.5 transition-all duration-1000 relative overflow-hidden backdrop-blur-sm border ${
        updatedFields[brew.batch_id]?.sg ? 'shadow-[0_0_25px_hsl(var(--primary)/0.5)] border-primary/50' : ''
      }`}
      style={{ 
        containerType: 'size',
        ...baseStyles,
        boxShadow: updatedFields[brew.batch_id]?.sg 
          ? undefined 
          : '0 6px 20px hsl(222 30% 3% / 0.6), 0 3px 8px hsl(222 30% 3% / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.06)'
      }}
    >
      <p className="text-muted-foreground/60 tracking-wide flex items-center justify-center z-10 px-1 font-normal" style={{ fontSize: 'max(12px, min(2.2vh, 1.5vw))' }}>Gravity</p>
      <p 
        className={`font-bold text-primary leading-none flex items-center justify-center z-10 px-1 tabular-nums ${updatedFields[brew.batch_id]?.sg ? 'animate-value-shimmer' : ''}`}
        style={{ 
          fontSize: 'max(32px, min(6vh, 3vw))',
          textShadow: '0 0 20px hsl(var(--primary) / 0.4)'
        }}
      >
        {brew.currentSG.toFixed(3)}
      </p>
      <div className="text-muted-foreground/70 mt-0.5 space-y-0.5 z-10 text-center px-1 w-full">
        <p className="tabular-nums truncate" style={{ fontSize: 'max(10px, min(1.5vh, 1.1vw))' }}>OG: {brew.originalGravity.toFixed(3)}</p>
        <p className="tabular-nums truncate" style={{ fontSize: 'max(10px, min(1.5vh, 1.1vw))' }}>FG: {brew.finalGravity.toFixed(3)}</p>
        <p className="font-medium truncate" style={{ fontSize: 'max(10px, min(1.5vh, 1.1vw))' }}>
          {brew.fermentationRate !== null ? (
            <>{brew.fermentationRate > 0 ? '-' : '+'}{Math.abs(brew.fermentationRate).toFixed(3)}/dygn</>
          ) : (
            <>Beräknar...</>
          )}
        </p>
      </div>
    </div>
  );
}
