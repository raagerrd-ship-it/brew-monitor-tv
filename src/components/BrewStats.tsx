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
        <div className="rounded-2xl bg-muted/50 backdrop-blur-sm p-2 border border-primary/10 overflow-hidden">
          <div className="text-center flex flex-col justify-center h-full min-w-0">
            <div className="inline-flex rounded-full bg-primary/20 p-2 mb-0.5 mx-auto">
              <Droplets className="h-5 w-5 text-primary" />
            </div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5 font-semibold">SG</p>
            <p className="text-4xl font-bold text-primary mb-0.5 leading-none">
              {brew.currentSG.toFixed(3)}
            </p>
            <p className="text-[9px] text-muted-foreground font-medium truncate px-1">
              Start: {brew.originalGravity.toFixed(3)}
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-muted/50 backdrop-blur-sm p-2 border border-temp-blue/10 overflow-hidden">
          <div className="text-center flex flex-col justify-center h-full min-w-0">
            <div className="inline-flex rounded-full bg-temp-blue/20 p-2 mb-0.5 mx-auto animate-pulse">
              <Thermometer className="h-5 w-5 text-temp-blue" />
            </div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5 font-semibold">Temp</p>
            <p className="text-4xl font-bold text-temp-blue leading-none">
              {brew.currentTemp}°
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-muted/50 backdrop-blur-sm p-2 border border-ferment-green/10 overflow-hidden">
          <div className="text-center flex flex-col justify-center h-full min-w-0">
            <div className="inline-flex rounded-full bg-ferment-green/20 p-2 mb-0.5 mx-auto">
              <TrendingDown className="h-5 w-5 text-ferment-green" />
            </div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5 font-semibold">Utjäsning</p>
            <p className="text-4xl font-bold text-ferment-green mb-1 leading-none">
              {brew.attenuation}%
            </p>
            <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full transition-all duration-300" 
                style={{ 
                  width: `${brew.attenuation}%`,
                  backgroundColor: '#22c55e'
                }}
              />
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-muted/50 backdrop-blur-sm p-2 border border-beer-gold/10 overflow-hidden">
          <div className="text-center flex flex-col justify-center h-full min-w-0">
            <div className="inline-flex rounded-full bg-beer-gold/30 p-2 mb-0.5 mx-auto">
              <Wine className="h-5 w-5 text-beer-gold" />
            </div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5 font-semibold">ABV</p>
            <p className="text-4xl font-bold text-beer-gold leading-none">
              {brew.abv}%
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
