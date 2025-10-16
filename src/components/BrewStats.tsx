import { Droplets, Thermometer, TrendingDown, Wine } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface BrewStatsProps {
  brew: {
    currentSG: number;
    currentTemp: number;
    attenuation: number;
    abv: number;
    originalGravity: number;
    lastUpdate: string;
  };
}

export function BrewStats({ brew }: BrewStatsProps) {
  return (
    <div className="space-y-3">
      {/* Primary Stats Grid - Larger for display */}
      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-2xl bg-muted/50 backdrop-blur-sm p-6 border border-primary/10">
          <div className="text-center">
            <div className="inline-flex rounded-full bg-primary/20 p-4 mb-4">
              <Droplets className="h-10 w-10 text-primary" />
            </div>
            <p className="text-base text-muted-foreground uppercase tracking-wide mb-2 font-semibold">SG</p>
            <p className="text-6xl font-bold text-primary mb-2">
              {brew.currentSG.toFixed(3)}
            </p>
            <p className="text-sm text-muted-foreground font-medium">
              Start: {brew.originalGravity.toFixed(3)}
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-muted/50 backdrop-blur-sm p-6 border border-temp-blue/10">
          <div className="text-center">
            <div className="inline-flex rounded-full bg-temp-blue/20 p-4 mb-4 animate-pulse">
              <Thermometer className="h-10 w-10 text-temp-blue" />
            </div>
            <p className="text-base text-muted-foreground uppercase tracking-wide mb-2 font-semibold">Temperatur</p>
            <p className="text-6xl font-bold text-temp-blue">
              {brew.currentTemp}°C
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-muted/50 backdrop-blur-sm p-6 border border-ferment-green/10">
          <div className="text-center">
            <div className="inline-flex rounded-full bg-ferment-green/20 p-4 mb-4">
              <TrendingDown className="h-10 w-10 text-ferment-green" />
            </div>
            <p className="text-base text-muted-foreground uppercase tracking-wide mb-2 font-semibold">Utjäsning</p>
            <p className="text-6xl font-bold text-ferment-green mb-3">
              {brew.attenuation}%
            </p>
            <Progress 
              value={brew.attenuation} 
              className={`h-4 bg-background [&>div]:bg-ferment-green [&>div]:rounded-full transition-all duration-500 ${
                brew.attenuation > 75 ? '[&>div]:shadow-[0_0_15px_hsl(var(--ferment-green))]' : ''
              }`} 
            />
          </div>
        </div>

        <div className="rounded-2xl bg-muted/50 backdrop-blur-sm p-6 border border-secondary/10">
          <div className="text-center">
            <div className="inline-flex rounded-full bg-secondary/20 p-4 mb-4">
              <Wine className="h-10 w-10 text-secondary" />
            </div>
            <p className="text-base text-muted-foreground uppercase tracking-wide mb-2 font-semibold">ABV</p>
            <p className="text-6xl font-bold text-secondary">
              {brew.abv}%
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
