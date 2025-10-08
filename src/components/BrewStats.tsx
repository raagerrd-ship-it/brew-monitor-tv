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
        <div className="rounded-2xl bg-muted/50 backdrop-blur-sm p-5 border border-primary/10">
          <div className="text-center">
            <div className="inline-flex rounded-full bg-primary/20 p-3 mb-3">
              <Droplets className="h-8 w-8 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground uppercase tracking-wide mb-1">SG</p>
            <p className="text-4xl font-bold text-primary mb-1">
              {brew.currentSG.toFixed(3)}
            </p>
            <p className="text-xs text-muted-foreground">
              Start: {brew.originalGravity.toFixed(3)}
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-muted/50 backdrop-blur-sm p-5 border border-temp-blue/10">
          <div className="text-center">
            <div className="inline-flex rounded-full bg-temp-blue/20 p-3 mb-3 animate-pulse">
              <Thermometer className="h-8 w-8 text-temp-blue" />
            </div>
            <p className="text-sm text-muted-foreground uppercase tracking-wide mb-1">Temperatur</p>
            <p className="text-4xl font-bold text-temp-blue">
              {brew.currentTemp}°C
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-muted/50 backdrop-blur-sm p-5 border border-ferment-green/10">
          <div className="text-center">
            <div className="inline-flex rounded-full bg-ferment-green/20 p-3 mb-3">
              <TrendingDown className="h-8 w-8 text-ferment-green" />
            </div>
            <p className="text-sm text-muted-foreground uppercase tracking-wide mb-1">Utjäsning</p>
            <p className="text-4xl font-bold text-ferment-green mb-2">
              {brew.attenuation}%
            </p>
            <Progress 
              value={brew.attenuation} 
              className={`h-3 bg-background [&>div]:bg-ferment-green [&>div]:rounded-full transition-all duration-500 ${
                brew.attenuation > 75 ? '[&>div]:shadow-[0_0_15px_hsl(var(--ferment-green))]' : ''
              }`} 
            />
          </div>
        </div>

        <div className="rounded-2xl bg-muted/50 backdrop-blur-sm p-5 border border-secondary/10">
          <div className="text-center">
            <div className="inline-flex rounded-full bg-secondary/20 p-3 mb-3">
              <Wine className="h-8 w-8 text-secondary" />
            </div>
            <p className="text-sm text-muted-foreground uppercase tracking-wide mb-1">ABV</p>
            <p className="text-4xl font-bold text-secondary">
              {brew.abv}%
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
