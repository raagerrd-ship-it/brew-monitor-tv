import { useMemo, memo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTvMode } from "@/contexts/TvModeContext";

import { LazyBrewChart } from "../brew-chart/LazyBrewChart";
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

import { SyncedDataDialog } from "./SyncedDataDialog";

// Fixed heights in pixels for consistent layout (optimized for 720p)
const CARD_HEADER_HEIGHT = 80;
const CARD_STATS_HEIGHT = 140;

function BrewCardComponent({
  brew,
  updatedFields,
  isAuthenticated,
  pills,
  controllers,
  onShareBrew,
  onEventsChange,
  
  cardIndex = 0,
  hasAlbumArtBackground = false,
  brewCount,
}: BrewCardProps) {
  const [syncedDataOpen, setSyncedDataOpen] = useState(false);
  const { isTvMode } = useTvMode();
  
  // Memoize expensive calculations
  const devices = useMemo(() => 
    findDevicesForBrew(brew, pills, controllers), 
    [brew.linked_controller_id, brew.linked_pill_id, pills, controllers]
  );
  
  const statusText = useMemo(() => 
    getStatusDisplayText(brew), 
    [brew.status, brew.fermentationRate]
  );
  
  const isCompletedOrConditioning = brew.status === "Konditionering" || brew.status === "Klar";
  const hasLabel = !!brew.label_image_url;
  
  const showInteractiveElements = isAuthenticated && !isTvMode;

  return (
    <Card 
      className={`border-white/15 shadow-deep flex flex-col overflow-hidden h-full relative ${
        showInteractiveElements ? 'group' : ''
      }`}
      style={{
        background: hasAlbumArtBackground
          ? 'hsl(222 18% 15% / 0.75)'
          : 'hsl(222 18% 15%)',
        boxShadow: '0 8px 24px hsl(222 30% 3% / 0.7), 0 20px 40px hsl(222 30% 2% / 0.5)',
      }}
    >
      
      {/* Header - fixed height */}
      <div className="px-3 py-2 flex-shrink-0 relative" style={{ height: `${CARD_HEADER_HEIGHT}px`, containerType: 'size' }}>
        {/* Gradient header border */}
        <div 
          className="absolute bottom-0 left-0 right-0 h-[1px]"
          style={{
            background: 'linear-gradient(90deg, transparent 5%, hsl(var(--border) / 0.5) 25%, hsl(var(--border) / 0.6) 50%, hsl(var(--border) / 0.5) 75%, transparent 95%)'
          }}
        />
        <div className="flex items-center justify-between gap-2 h-full">
          {/* Label image thumbnail */}
          {brew.label_image_url && (
            <div 
              className="flex-shrink-0 rounded-lg overflow-hidden border border-white/10 bg-muted/30"
              style={{ width: '60px', height: '60px' }}
            >
              <img
                src={brew.label_image_url}
                alt={`${brew.name} etikett`}
                className="h-full w-full object-cover"
              />
            </div>
          )}
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="flex items-center justify-between gap-1.5">
                <h2 
                  className="font-bold text-foreground leading-tight truncate tracking-tight flex items-center gap-1.5"
                  style={{ 
                    fontSize: '18px',
                    textShadow: '0 2px 8px hsl(0 0% 0% / 0.4)',
                    letterSpacing: '-0.02em'
                  }}
                >
                  {brew.name}
                  {brew.batch_id.startsWith('custom_') && (
                    <span
                      className="inline-flex items-center rounded px-1.5 py-0.5 font-bold uppercase tracking-wider"
                      style={{
                        fontSize: '9px',
                        background: 'linear-gradient(135deg, hsl(var(--accent) / 0.3) 0%, hsl(var(--accent) / 0.15) 100%)',
                        color: 'hsl(var(--accent-foreground) / 0.9)',
                        border: '1px solid hsl(var(--accent) / 0.4)',
                      }}
                    >
                      #{brew.batchNumber}
                    </span>
                  )}
                </h2>
                {/* Status badge - glassmorphism style, right of title */}
                <span
                  className="rounded-full px-2 py-0.5 font-semibold whitespace-nowrap flex-shrink-0 backdrop-blur-md"
                  style={{ 
                    fontSize: '11px',
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
              <p 
                className="text-muted-foreground/60 truncate font-medium" 
                style={{ fontSize: '11px', letterSpacing: '0.02em' }}
              >
                {brew.batch_id.startsWith('custom_') ? (
                  <>
                    {brew.style && brew.style !== "Okänd stil" ? `${brew.style} • ` : ""}{brew.lastUpdate}
                  </>
                ) : (
                  <>
                    {brew.style && brew.style !== "Okänd stil" ? `${brew.style} • ` : ""}{brew.lastUpdate} • {brew.batchNumber}
                  </>
                )}
              </p>
            </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Action buttons - only visible when authenticated and not in TV mode */}
            {showInteractiveElements && (
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
          </div>
        </div>
      </div>
      
      {/* Chart Area - fills remaining space */}
      <div className="flex-1 min-h-0 p-2 pb-1 flex flex-col">
        <div className="flex-1 min-h-0 overflow-hidden">
          <LazyBrewChart 
            data={brew.sgData} 
            og={brew.originalGravity} 
            fg={brew.finalGravity} 
            singleView={true}
            events={brew.events}
            controllerId={brew.linked_controller_id}
            chartIndex={cardIndex}
            brewId={brew.id}
            hasFermentationSession={!!brew.fermentationSession}
            lastUpdateRaw={brew.lastUpdateRaw}
            brewCount={brewCount}
          />
        </div>
        
        {/* Active Fermentation Session - overflow-visible so shadow isn't clipped */}
        <div className="mt-1 flex-shrink-0 px-1 overflow-visible">
          <ActiveFermentationSession 
            brewId={brew.id} 
            compact 
            preloadedSession={brew.fermentationSession}
            isAuthenticated={showInteractiveElements}
            currentSg={brew.currentSG}
            originalGravity={brew.originalGravity}
            sgData={brew.sgData}
          />
        </div>
      </div>

      {/* Stats Grid - fixed height */}
      <div className="px-3 py-1.5 flex-shrink-0" style={{ height: `${CARD_STATS_HEIGHT}px` }}>
        <div className="grid grid-cols-3 grid-rows-2 gap-1.5 h-full">
          <GravityStat 
            brew={brew} 
            updatedFields={updatedFields} 
            onSyncedDataClick={showInteractiveElements ? () => setSyncedDataOpen(true) : undefined}
          />
          <AbvStat brew={brew} updatedFields={updatedFields} />
          <TempStat 
            brew={brew} 
            devices={devices} 
            updatedFields={updatedFields} 
          />
          <AttenuationStat brew={brew} updatedFields={updatedFields} />
          <BatteryStat brew={brew} devices={devices} updatedFields={updatedFields} />
        </div>
      </div>
      
      {/* Synced Data Dialog for custom brews */}
      {brew.batch_id.startsWith('custom_') && (
        <SyncedDataDialog
          open={syncedDataOpen}
          onOpenChange={setSyncedDataOpen}
          brewName={brew.name}
          sgData={brew.sgData}
          controllerId={brew.linked_controller_id}
        />
      )}
    </Card>
  );
}

export const BrewCard = memo(BrewCardComponent);
