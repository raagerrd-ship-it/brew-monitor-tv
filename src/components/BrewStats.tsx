import { Droplets, Thermometer, TrendingDown, Wine } from "lucide-react";

interface BrewStatsProps {
  brew: {
    currentSG: number;
    currentTemp: number;
    attenuation: number;
    abv: number;
    lastUpdate: string;
  };
}

export function BrewStats({ brew }: BrewStatsProps) {
  return (
    <div className="space-y-4">
      {/* Primary Stats Grid */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg bg-muted p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-primary/20 p-2">
              <Droplets className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Specifik Gravitet</p>
              <p className="text-3xl font-bold text-primary">
                {brew.currentSG.toFixed(3)}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-muted p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-temp-blue/20 p-2">
              <Thermometer className="h-6 w-6 text-temp-blue" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Temperatur</p>
              <p className="text-3xl font-bold text-temp-blue">
                {brew.currentTemp}°C
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-muted p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-ferment-green/20 p-2">
              <TrendingDown className="h-6 w-6 text-ferment-green" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Utjäsning</p>
              <p className="text-3xl font-bold text-ferment-green">
                {brew.attenuation}%
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-muted p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-secondary/20 p-2">
              <Wine className="h-6 w-6 text-secondary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Alkoholhalt</p>
              <p className="text-3xl font-bold text-secondary">
                {brew.abv}%
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Last Update */}
      <div className="text-center text-sm text-muted-foreground">
        Senast uppdaterad: {brew.lastUpdate}
      </div>
    </div>
  );
}
