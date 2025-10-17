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
        <div className="rounded-2xl bg-muted/50 backdrop-blur-sm p-2 border border-primary/10">
          <div className="text-center flex flex-col justify-center h-full">
            <div className="inline-flex rounded-full bg-primary/20 p-2 mb-0.5 mx-auto">
              <Droplets className="h-6 w-6 text-primary" />
            </div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5 font-semibold">SG</p>
            <p className="text-5xl sm:text-6xl font-bold text-primary mb-0.5 leading-none break-all">
              {brew.currentSG.toFixed(3)}
            </p>
            <p className="text-[10px] text-muted-foreground font-medium">
              Start: {brew.originalGravity.toFixed(3)}
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-muted/50 backdrop-blur-sm p-2 border border-temp-blue/10">
          <div className="text-center flex flex-col justify-center h-full">
            <div className="inline-flex rounded-full bg-temp-blue/20 p-2 mb-0.5 mx-auto animate-pulse">
              <Thermometer className="h-6 w-6 text-temp-blue" />
            </div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5 font-semibold">Temp</p>
            <p className="text-7xl font-bold text-temp-blue leading-none">
              {brew.currentTemp}°
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-muted/50 backdrop-blur-sm p-2 border border-ferment-green/10">
          <div className="text-center flex flex-col justify-center h-full">
            <div className="inline-flex rounded-full bg-ferment-green/20 p-2 mb-0.5 mx-auto">
              <TrendingDown className="h-6 w-6 text-ferment-green" />
            </div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5 font-semibold">Utjäsning</p>
            <p className="text-7xl font-bold text-ferment-green mb-1 leading-none">
              {brew.attenuation}%
            </p>
            <Progress 
              value={brew.attenuation} 
              className={`h-2.5 bg-background [&>div]:bg-ferment-green [&>div]:rounded-full transition-all duration-500 ${
                brew.attenuation > 75 ? '[&>div]:shadow-[0_0_15px_hsl(var(--ferment-green))]' : ''
              }`} 
            />
          </div>
        </div>

        <div className="rounded-2xl bg-muted/50 backdrop-blur-sm p-2 border border-secondary/10">
          <div className="text-center flex flex-col justify-center h-full">
            <div className="inline-flex rounded-full bg-secondary/20 p-2 mb-0.5 mx-auto">
              <Wine className="h-6 w-6 text-secondary" />
            </div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5 font-semibold">ABV</p>
            <p className="text-7xl font-bold text-secondary leading-none">
              {brew.abv}%
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
