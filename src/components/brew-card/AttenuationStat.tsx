import { memo } from "react";
import { BrewData } from "@/types/brew";

import { StatCard } from "./StatCard";


interface AttenuationStatProps {
  brew: BrewData;
  updatedFields: Record<string, Record<string, boolean>>;
}

function AttenuationStatComponent({ brew, updatedFields }: AttenuationStatProps) {
  const color = "hsl(var(--ferment-green))";

  return (
    <StatCard
      label="Utjäsning"
      value={<span className="tabular-nums">{brew.attenuation}<span className="text-muted-foreground/40">%</span></span>}
      color={color}
      isUpdated={updatedFields[brew.batch_id]?.attenuation}
    />
  );
}

export const AttenuationStat = memo(AttenuationStatComponent);
