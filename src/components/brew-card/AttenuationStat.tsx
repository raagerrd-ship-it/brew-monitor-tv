import { memo } from "react";
import { BrewData } from "@/types/brew";
import { isBrewInactive } from "./utils";
import { StatCard } from "./StatCard";

interface AttenuationStatProps {
  brew: BrewData;
  updatedFields: Record<string, Record<string, boolean>>;
}

function AttenuationStatComponent({ brew, updatedFields }: AttenuationStatProps) {
  const isInactive = isBrewInactive(brew.status);
  const color = "hsl(var(--ferment-green))";

  const bubblesIcon = (
    <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
      <circle cx="14" cy="22" r="1" stroke={color} strokeWidth="0.5" fill="none" opacity={brew.attenuation >= 80 ? "0.7" : "0.15"} className={isInactive ? '' : 'animate-pulse'} style={{ animationDelay: '0.4s' }} />
      <circle cx="8" cy="20" r="1.2" stroke={color} strokeWidth="0.6" fill="none" opacity={brew.attenuation >= 80 ? "0.7" : "0.15"} className={isInactive ? '' : 'animate-pulse'} />
      <circle cx="18" cy="20" r="1.8" stroke={color} strokeWidth="0.6" fill="none" opacity={brew.attenuation >= 70 ? "0.6" : "0.15"} className={isInactive ? '' : 'animate-pulse'} style={{ animationDelay: '0.5s' }} />
      <circle cx="8" cy="18" r="2.5" stroke={color} strokeWidth="0.75" fill="none" opacity={brew.attenuation >= 60 ? "0.6" : "0.15"} className={isInactive ? '' : 'animate-pulse'} />
      <circle cx="10" cy="16" r="1.3" stroke={color} strokeWidth="0.6" fill="none" opacity={brew.attenuation >= 50 ? "0.5" : "0.15"} className={isInactive ? '' : 'animate-pulse'} style={{ animationDelay: '0.8s' }} />
      <circle cx="16" cy="14" r="3" stroke={color} strokeWidth="0.75" fill="none" opacity={brew.attenuation >= 40 ? "0.5" : "0.15"} className={isInactive ? '' : 'animate-pulse'} style={{ animationDelay: '0.3s' }} />
      <circle cx="6" cy="12" r="1.5" stroke={color} strokeWidth="0.6" fill="none" opacity={brew.attenuation >= 30 ? "0.4" : "0.15"} className={isInactive ? '' : 'animate-pulse'} style={{ animationDelay: '0.2s' }} />
      <circle cx="16" cy="10" r="0.8" stroke={color} strokeWidth="0.5" fill="none" opacity={brew.attenuation >= 20 ? "0.35" : "0.15"} className={isInactive ? '' : 'animate-pulse'} style={{ animationDelay: '0.1s' }} />
      <circle cx="12" cy="8" r="2" stroke={color} strokeWidth="0.75" fill="none" opacity={brew.attenuation >= 10 ? "0.35" : "0.15"} className={isInactive ? '' : 'animate-pulse'} style={{ animationDelay: '0.6s' }} />
      <circle cx="9" cy="6" r="1.2" stroke={color} strokeWidth="0.5" fill="none" opacity={brew.attenuation >= 5 ? "0.3" : "0.15"} className={isInactive ? '' : 'animate-pulse'} style={{ animationDelay: '0.7s' }} />
    </svg>
  );

  return (
    <StatCard
      label="Utjäsning"
      value={`${brew.attenuation}%`}
      color={color}
      isUpdated={updatedFields[brew.batch_id]?.attenuation}
      icon={bubblesIcon}
    />
  );
}

export const AttenuationStat = memo(AttenuationStatComponent);
