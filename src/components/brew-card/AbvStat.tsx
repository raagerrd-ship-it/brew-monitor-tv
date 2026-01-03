import { BrewData } from "@/types/brew";
import { calculateAbvFillOffset } from "./utils";

interface AbvStatProps {
  brew: BrewData;
  updatedFields: Record<string, Record<string, boolean>>;
}

export function AbvStat({ brew, updatedFields }: AbvStatProps) {
  const fillOffset = calculateAbvFillOffset(brew.abv);

  return (
    <div 
      className={`rounded-xl p-1.5 pr-3 flex flex-col items-start justify-center gap-0 backdrop-blur-sm border border-secondary/20 transition-all duration-1000 relative overflow-hidden ${
        updatedFields[brew.batch_id]?.abv ? 'shadow-[0_0_25px_hsl(var(--secondary)/0.5)] border-secondary/50' : ''
      }`}
      style={{ 
        containerType: 'size',
        background: 'linear-gradient(135deg, hsl(45 80% 55% / 0.06) 0%, hsl(222 18% 15% / 0.5) 100%)',
        boxShadow: updatedFields[brew.batch_id]?.abv 
          ? undefined 
          : '0 6px 20px hsl(222 30% 3% / 0.6), 0 3px 8px hsl(222 30% 3% / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.06)'
      }}
    >
      <div className="absolute top-1/2 -translate-y-1/2 opacity-10" style={{ width: '60%', height: '60%', right: '-15%' }}>
        <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
          <defs>
            <linearGradient id={`abvFill-${brew.batch_id}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--secondary))" stopOpacity="0.05"/>
              <stop offset={`${fillOffset}%`} stopColor="hsl(var(--secondary))" stopOpacity="0.05"/>
              <stop offset={`${fillOffset}%`} stopColor="hsl(var(--secondary))" stopOpacity="0.6"/>
              <stop offset="100%" stopColor="hsl(var(--secondary))" stopOpacity="0.6"/>
            </linearGradient>
          </defs>
          <path d="M8 2l-1 12c0 2 2 4 5 4s5-2 5-4L16 2z" stroke="hsl(var(--secondary))" strokeWidth="0.75" fill={`url(#abvFill-${brew.batch_id})`}/>
          <line x1="12" y1="18" x2="12" y2="22" stroke="hsl(var(--secondary))" strokeWidth="0.75"/>
          <line x1="9" y1="22" x2="15" y2="22" stroke="hsl(var(--secondary))" strokeWidth="0.75"/>
        </svg>
      </div>
      <p className="text-muted-foreground/60 tracking-wide z-10 pl-2 font-normal" style={{ fontSize: 'max(11px, min(1.8vh, 1vw))' }}>Abv</p>
      <p 
        className={`font-bold text-secondary leading-none z-10 pl-2 ${updatedFields[brew.batch_id]?.abv ? 'animate-value-shimmer' : ''}`}
        style={{ 
          fontSize: 'max(28px, min(5.5vh, 2.5vw))',
          textShadow: '0 0 15px hsl(var(--secondary) / 0.3)'
        }}
      >
        {brew.abv.toFixed(1)}%
      </p>
    </div>
  );
}
