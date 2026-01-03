import { BrewData } from "@/types/brew";
import { isBrewInactive } from "./utils";

interface AttenuationStatProps {
  brew: BrewData;
  updatedFields: Record<string, Record<string, boolean>>;
}

export function AttenuationStat({ brew, updatedFields }: AttenuationStatProps) {
  const isInactive = isBrewInactive(brew.status);

  return (
    <div 
      className={`rounded-xl p-1.5 pr-3 flex flex-col items-start justify-center gap-0 backdrop-blur-sm border border-ferment-green/20 transition-all duration-1000 relative overflow-hidden ${
        updatedFields[brew.batch_id]?.attenuation ? 'shadow-[0_0_25px_hsl(var(--ferment-green)/0.5)] border-ferment-green/50' : ''
      }`}
      style={{ 
        containerType: 'size',
        background: 'linear-gradient(135deg, hsl(120 50% 45% / 0.06) 0%, hsl(222 18% 15% / 0.5) 100%)',
        boxShadow: updatedFields[brew.batch_id]?.attenuation 
          ? undefined 
          : '0 6px 20px hsl(222 30% 3% / 0.6), 0 3px 8px hsl(222 30% 3% / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.06)'
      }}
    >
      <div className="absolute top-1/2 -translate-y-1/2 opacity-10" style={{ width: '55%', height: '55%', right: '-12%' }}>
        <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
          <circle cx="14" cy="22" r="1" stroke="hsl(var(--ferment-green))" strokeWidth="0.5" fill="none" opacity={brew.attenuation >= 80 ? "0.7" : "0.15"} className={isInactive ? '' : 'animate-pulse'} style={{ animationDelay: '0.4s' }} />
          <circle cx="8" cy="20" r="1.2" stroke="hsl(var(--ferment-green))" strokeWidth="0.6" fill="none" opacity={brew.attenuation >= 80 ? "0.7" : "0.15"} className={isInactive ? '' : 'animate-pulse'} />
          <circle cx="18" cy="20" r="1.8" stroke="hsl(var(--ferment-green))" strokeWidth="0.6" fill="none" opacity={brew.attenuation >= 70 ? "0.6" : "0.15"} className={isInactive ? '' : 'animate-pulse'} style={{ animationDelay: '0.5s' }} />
          <circle cx="8" cy="18" r="2.5" stroke="hsl(var(--ferment-green))" strokeWidth="0.75" fill="none" opacity={brew.attenuation >= 60 ? "0.6" : "0.15"} className={isInactive ? '' : 'animate-pulse'} />
          <circle cx="10" cy="16" r="1.3" stroke="hsl(var(--ferment-green))" strokeWidth="0.6" fill="none" opacity={brew.attenuation >= 50 ? "0.5" : "0.15"} className={isInactive ? '' : 'animate-pulse'} style={{ animationDelay: '0.8s' }} />
          <circle cx="16" cy="14" r="3" stroke="hsl(var(--ferment-green))" strokeWidth="0.75" fill="none" opacity={brew.attenuation >= 40 ? "0.5" : "0.15"} className={isInactive ? '' : 'animate-pulse'} style={{ animationDelay: '0.3s' }} />
          <circle cx="6" cy="12" r="1.5" stroke="hsl(var(--ferment-green))" strokeWidth="0.6" fill="none" opacity={brew.attenuation >= 30 ? "0.4" : "0.15"} className={isInactive ? '' : 'animate-pulse'} style={{ animationDelay: '0.2s' }} />
          <circle cx="16" cy="10" r="0.8" stroke="hsl(var(--ferment-green))" strokeWidth="0.5" fill="none" opacity={brew.attenuation >= 20 ? "0.35" : "0.15"} className={isInactive ? '' : 'animate-pulse'} style={{ animationDelay: '0.1s' }} />
          <circle cx="12" cy="8" r="2" stroke="hsl(var(--ferment-green))" strokeWidth="0.75" fill="none" opacity={brew.attenuation >= 10 ? "0.35" : "0.15"} className={isInactive ? '' : 'animate-pulse'} style={{ animationDelay: '0.6s' }} />
          <circle cx="9" cy="6" r="1.2" stroke="hsl(var(--ferment-green))" strokeWidth="0.5" fill="none" opacity={brew.attenuation >= 5 ? "0.3" : "0.15"} className={isInactive ? '' : 'animate-pulse'} style={{ animationDelay: '0.7s' }} />
        </svg>
      </div>
      <p className="text-muted-foreground/60 tracking-wide z-10 pl-2 font-normal" style={{ fontSize: 'max(11px, min(1.8vh, 1vw))' }}>Utjäsning</p>
      <p 
        className={`font-bold text-ferment-green leading-none z-10 pl-2 ${updatedFields[brew.batch_id]?.attenuation ? 'animate-value-shimmer' : ''}`}
        style={{ 
          fontSize: 'max(28px, min(5.5vh, 2.5vw))',
          textShadow: '0 0 15px hsl(var(--ferment-green) / 0.3)'
        }}
      >
        {brew.attenuation}%
      </p>
    </div>
  );
}
