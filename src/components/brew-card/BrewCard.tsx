import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BrewChart } from "../brew-chart";
import { BrewEventDialog } from "../BrewEventDialog";
import { ActiveFermentationSession } from "../fermentation";
import { Share2 } from "lucide-react";
import { findDevicesForBrew } from "@/lib/brew-utils";
import { BrewCardProps } from "./types";
import { getStatusDisplayText } from "./utils";
import { GravityStat } from "./GravityStat";
import { AbvStat } from "./AbvStat";
import { TempStat } from "./TempStat";
import { AttenuationStat } from "./AttenuationStat";
import { BatteryStat } from "./BatteryStat";

export function BrewCard({
  brew,
  updatedFields,
  isAuthenticated,
  pills,
  controllers,
  onShareBrew,
  onEventsChange,
  onDeviceLinkOpen,
}: BrewCardProps) {
  const hasCardGlow = updatedFields[brew.batch_id]?.cardGlow;
  const devices = findDevicesForBrew(brew, pills, controllers);
  const statusText = getStatusDisplayText(brew);
  const isCompletedOrConditioning = brew.status === "Konditionering" || brew.status === "Klar";

  return (
    <Card 
      className={`border-white/15 shadow-deep flex flex-col overflow-hidden h-full relative backdrop-blur-xl ${
        isAuthenticated ? 'group' : ''
      } ${
        hasCardGlow ? 'ring-2 ring-primary/50 shadow-[0_0_30px_hsl(var(--primary)/0.4)]' : ''
      }`}
      style={{
        background: 'linear-gradient(180deg, hsl(222 18% 18% / 0.65) 0%, hsl(222 20% 12% / 0.75) 100%)',
        boxShadow: hasCardGlow 
          ? undefined 
          : '0 8px 32px hsl(222 30% 5% / 0.6), inset 0 1px 0 hsl(0 0% 100% / 0.12), inset 0 -1px 0 hsl(0 0% 0% / 0.2)',
      }}
    >
      {/* Glass highlight overlay - top edge */}
      <div 
        className="absolute inset-x-0 top-0 h-[1px] pointer-events-none z-10"
        style={{
          background: 'linear-gradient(90deg, transparent 10%, hsl(0 0% 100% / 0.08) 30%, hsl(0 0% 100% / 0.12) 50%, hsl(0 0% 100% / 0.08) 70%, transparent 90%)'
        }}
      />
      
      {/* Header - 10% */}
      <div className="h-[10%] px-3 py-2 flex-shrink-0 relative" style={{ containerType: 'size' }}>
        {/* Gradient header border */}
        <div 
          className="absolute bottom-0 left-0 right-0 h-[1px]"
          style={{
            background: 'linear-gradient(90deg, transparent 5%, hsl(var(--border) / 0.5) 25%, hsl(var(--border) / 0.6) 50%, hsl(var(--border) / 0.5) 75%, transparent 95%)'
          }}
        />
        <div className="flex items-center justify-between gap-2 h-full">
          <div className="min-w-0 flex-1 overflow-hidden">
            <h2 
              className="font-bold text-foreground leading-tight truncate tracking-tight"
              style={{ 
                fontSize: 'max(18px, min(2.8vh, 2.6vw))',
                textShadow: '0 2px 8px hsl(0 0% 0% / 0.4)',
                letterSpacing: '-0.02em'
              }}
            >
              {brew.name}
            </h2>
            <p 
              className="text-muted-foreground/60 truncate font-medium" 
              style={{ fontSize: 'max(14px, min(1.6vh, 1.8vw))', letterSpacing: '0.02em' }}
            >
              {brew.style && brew.style !== "Okänd stil" ? `${brew.style} • ` : ""}{brew.lastUpdate} • {brew.batchNumber}
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Action buttons - only visible when authenticated */}
            {isAuthenticated && (
              <div className="flex items-center gap-1 max-w-0 group-hover:max-w-[80px] overflow-hidden transition-all duration-200">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onShareBrew(brew)}
                  className="h-7 w-7 hover:bg-primary/10 text-muted-foreground hover:text-foreground flex-shrink-0"
                  title="Dela detta öl"
                >
                  <Share2 className="h-3.5 w-3.5" />
                </Button>
                <BrewEventDialog
                  brewId={brew.id}
                  brewName={brew.name}
                  events={brew.events}
                  onEventsChange={onEventsChange}
                />
              </div>
            )}
            {/* Status badge - glassmorphism style */}
            <span
              className="rounded-full px-2.5 py-1 font-semibold whitespace-nowrap flex-shrink-0 backdrop-blur-md"
              style={{ 
                fontSize: 'min(1.6vh, 1.8vw)',
                background: isCompletedOrConditioning 
                  ? "linear-gradient(135deg, hsl(var(--primary) / 0.25) 0%, hsl(var(--primary) / 0.1) 100%)" 
                  : "linear-gradient(135deg, hsl(var(--ferment-green) / 0.25) 0%, hsl(var(--ferment-green) / 0.1) 100%)",
                color: isCompletedOrConditioning ? "hsl(var(--primary))" : "hsl(var(--ferment-green))",
                border: isCompletedOrConditioning
                  ? "1px solid hsl(var(--primary) / 0.3)" 
                  : "1px solid hsl(var(--ferment-green) / 0.4)",
                boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.1), inset 0 -1px 0 hsl(0 0% 0% / 0.05)",
                textShadow: "none"
              }}
            >
              {statusText}
            </span>
          </div>
        </div>
      </div>
      
      {/* Chart Area - adjusts based on active session */}
      <div className="flex-1 min-h-0 p-2 pb-1 flex flex-col">
        <div className="flex-1 min-h-0">
          <BrewChart 
            data={brew.sgData} 
            og={brew.originalGravity} 
            fg={brew.finalGravity} 
            singleView={true}
            events={brew.events}
            controllerId={brew.linked_controller_id}
          />
        </div>
        
        {/* Active Fermentation Session - compact view */}
        <div className="mt-1 flex-shrink-0">
          <ActiveFermentationSession 
            brewId={brew.id} 
            compact 
            preloadedSession={brew.fermentationSession}
          />
        </div>
      </div>

      {/* Stats Grid - 32% */}
      <div className="h-[32%] px-3 py-1.5 flex-shrink-0">
        <div className="grid grid-cols-3 grid-rows-2 gap-1.5 h-full">
          <GravityStat brew={brew} updatedFields={updatedFields} />
          <AbvStat brew={brew} updatedFields={updatedFields} />
          <TempStat 
            brew={brew} 
            devices={devices} 
            updatedFields={updatedFields} 
            isAuthenticated={isAuthenticated}
            onDeviceLinkOpen={onDeviceLinkOpen}
          />
          <AttenuationStat brew={brew} updatedFields={updatedFields} />
          <BatteryStat brew={brew} devices={devices} updatedFields={updatedFields} />
        </div>
      </div>
    </Card>
  );
}
