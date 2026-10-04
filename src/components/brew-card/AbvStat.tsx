import { memo } from "react";
import { BrewData } from "@/types/brew";

import { StatCard } from "./StatCard";
import { RollingNumber } from "@/components/RollingNumber";

interface AbvStatProps {
  brew: BrewData;
  updatedFields: Record<string, Record<string, boolean>>;
}

function AbvStatComponent({ brew, updatedFields }: AbvStatProps) {
  const color = "hsl(var(--secondary))";

  return (
    <StatCard
      label="ABV"
      value={<RollingNumber value={brew.abv} decimals={1} suffix={<span className="text-muted-foreground/40">%</span>} />}
      color={color}
      isUpdated={updatedFields[brew.batch_id]?.abv}
    />
  );
}

export const AbvStat = memo(AbvStatComponent);
