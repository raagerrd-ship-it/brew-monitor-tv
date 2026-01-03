import { BrewData } from "@/types/brew";
import { calculateAbvFillOffset } from "./utils";
import { StatCard } from "./StatCard";

interface AbvStatProps {
  brew: BrewData;
  updatedFields: Record<string, Record<string, boolean>>;
}

export function AbvStat({ brew, updatedFields }: AbvStatProps) {
  const fillOffset = calculateAbvFillOffset(brew.abv);
  const color = "hsl(var(--secondary))";

  const glassIcon = (
    <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
      <defs>
        <linearGradient id={`abvFill-${brew.batch_id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.05"/>
          <stop offset={`${fillOffset}%`} stopColor={color} stopOpacity="0.05"/>
          <stop offset={`${fillOffset}%`} stopColor={color} stopOpacity="0.6"/>
          <stop offset="100%" stopColor={color} stopOpacity="0.6"/>
        </linearGradient>
      </defs>
      <path d="M8 2l-1 12c0 2 2 4 5 4s5-2 5-4L16 2z" stroke={color} strokeWidth="0.75" fill={`url(#abvFill-${brew.batch_id})`}/>
      <line x1="12" y1="18" x2="12" y2="22" stroke={color} strokeWidth="0.75"/>
      <line x1="9" y1="22" x2="15" y2="22" stroke={color} strokeWidth="0.75"/>
    </svg>
  );

  return (
    <StatCard
      label="Abv"
      value={`${brew.abv.toFixed(1)}%`}
      color={color}
      isUpdated={updatedFields[brew.batch_id]?.abv}
      icon={glassIcon}
    />
  );
}
