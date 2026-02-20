import { memo } from "react";
import { BrewData } from "@/types/brew";

import { StatCard } from "./StatCard";

interface AbvStatProps {
  brew: BrewData;
  updatedFields: Record<string, Record<string, boolean>>;
}

function AbvStatComponent({ brew, updatedFields }: AbvStatProps) {
  const color = "hsl(var(--secondary))";

  return (
    <StatCard
      label="ABV"
      value={<span className="tabular-nums">{brew.abv.toFixed(1)}<span className="text-muted-foreground/40">%</span></span>}
      color={color}
      isUpdated={updatedFields[brew.batch_id]?.abv}
    />
  );
}

export const AbvStat = memo(AbvStatComponent);
