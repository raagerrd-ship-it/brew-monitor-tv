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
    <div className="space-y-2">
      {/* Primary Stats Grid */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-muted/50 backdrop-blur-sm p-2.5 transition-all duration-200 hover:bg-muted/80 border border-primary/10">
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-primary/20 p-1.5">
              <Droplets className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">SG</p>
              <p className="text-xl font-bold text-primary">
                {brew.currentSG.toFixed(3)}
              </p>
              <p className="text-[10px] text-muted-foreground">
                Start: {brew.originalGravity.toFixed(3)}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-muted/50 backdrop-blur-sm p-2.5 flex items-center transition-all duration-200 hover:bg-muted/80 border border-temp-blue/10">
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-temp-blue/20 p-1.5 animate-pulse">
              <Thermometer className="h-4 w-4 text-temp-blue" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Temp</p>
              <p className="text-xl font-bold text-temp-blue">
                {brew.currentTemp}°C
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-muted/50 backdrop-blur-sm p-2.5 transition-all duration-200 hover:bg-muted/80 border border-ferment-green/10">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="rounded-full bg-ferment-green/20 p-1.5">
              <TrendingDown className="h-4 w-4 text-ferment-green" />
            </div>
            <div className="flex-1">
              <p className="text-xs text-muted-foreground">Utjäsning</p>
              <p className="text-xl font-bold text-ferment-green">
                {brew.attenuation}%
              </p>
            </div>
          </div>
          <Progress 
            value={brew.attenuation} 
            className={`h-2 bg-background [&>div]:bg-ferment-green [&>div]:rounded-full transition-all duration-500 ${
              brew.attenuation > 75 ? '[&>div]:shadow-[0_0_10px_hsl(var(--ferment-green))]' : ''
            }`} 
          />
        </div>

        <div className="rounded-xl bg-muted/50 backdrop-blur-sm p-2.5 flex items-center transition-all duration-200 hover:bg-muted/80 border border-secondary/10">
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-secondary/20 p-1.5">
              <Wine className="h-4 w-4 text-secondary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">ABV</p>
              <p className="text-xl font-bold text-secondary">
                {brew.abv}%
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
