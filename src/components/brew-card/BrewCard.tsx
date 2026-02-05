import { useMemo, memo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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
import { useTvMode } from "@/contexts/TvModeContext";

// Fixed heights in pixels for consistent layout (optimized for 720p)
const CARD_HEADER_HEIGHT = 64;
const CARD_STATS_HEIGHT = 140;

function BrewCardComponent({
  brew,
  updatedFields,
  isAuthenticated,
  pills,
  controllers,
  onShareBrew,
  onEventsChange,
  onDeviceLinkOpen,
  isTvMode: tvModeProp = false,
  cardIndex = 0,
  hasAlbumArtBackground = false,
}: BrewCardProps) {
  // Use context if not passed as prop
  const { isTvMode: tvModeContext } = useTvMode();
  const isTvMode = tvModeProp || tvModeContext;
  const [syncedDataOpen, setSyncedDataOpen] = useState(false);
  
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
  
  // In TV mode, disable interactive features
  const showInteractiveElements = isAuthenticated && !isTvMode;

  return (
    <Card 
      className={`border-white/15 shadow-deep flex flex-col overflow-hidden h-full relative transition-all duration-500 ${
        isTvMode ? '' : 'backdrop-blur-xl'
      } ${
        hasAlbumArtBackground ? 'backdrop-blur-md' : ''
      } ${
        showInteractiveElements ? 'group' : ''
      }`}
      style={{
        // When album art background is showing, make cards semi-transparent
        background: hasAlbumArtBackground
          ? 'hsl(222 18% 15% / 0.75)'
          : isTvMode 
            ? 'hsl(222 18% 15%)' 
            : 'linear-gradient(180deg, hsl(222 18% 18% / 0.65) 0%, hsl(222 20% 12% / 0.75) 100%)',
        boxShadow: isTvMode
          ? '0 8px 24px hsl(222 30% 3% / 0.7), 0 20px 40px hsl(222 30% 2% / 0.5)'
          : '0 12px 40px hsl(222 30% 3% / 0.7), 0 25px 60px hsl(222 30% 2% / 0.5), inset 0 1px 0 hsl(0 0% 100% / 0.12), inset 0 -1px 0 hsl(0 0% 0% / 0.2)',
      }}
    >
      {/* Glass highlight overlay - top edge (skip in TV mode) */}
      {!isTvMode && (
        <div 
          className="absolute inset-x-0 top-0 h-[1px] pointer-events-none z-10"
          style={{
            background: 'linear-gradient(90deg, transparent 10%, hsl(0 0% 100% / 0.08) 30%, hsl(0 0% 100% / 0.12) 50%, hsl(0 0% 100% / 0.08) 70%, transparent 90%)'
          }}
        />
      )}
      
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
          {/* Label image thumbnail if exists */}
          {brew.label_image_url && (
            <div className="flex-shrink-0 h-16 w-16 rounded-lg overflow-hidden border border-white/10 bg-muted/30">
              <img
                src={brew.label_image_url}
                alt={`${brew.name} etikett`}
                className="h-full w-full object-cover"
              />
            </div>
          )}
            <div className="min-w-0 flex-1 overflow-hidden">
              <h2 
                className="font-bold text-foreground leading-tight truncate tracking-tight flex items-center gap-1.5"
                style={{ 
                  fontSize: '28px',
                  textShadow: '0 2px 8px hsl(0 0% 0% / 0.4)',
                  letterSpacing: '-0.02em'
                }}
              >
                {brew.name}
                {brew.batch_id.startsWith('custom_') && (
                  <span
                    className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                    style={{
                      background: 'linear-gradient(135deg, hsl(var(--accent) / 0.3) 0%, hsl(var(--accent) / 0.15) 100%)',
                      color: 'hsl(var(--accent-foreground) / 0.9)',
                      border: '1px solid hsl(var(--accent) / 0.4)',
                    }}
                  >
                    Egen #{brew.batchNumber}
                  </span>
                )}
              </h2>
              <p 
                className="text-muted-foreground/60 truncate font-medium" 
                style={{ fontSize: '16px', letterSpacing: '0.02em' }}
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
            {/* Status badge - glassmorphism style */}
            <span
              className="rounded-full px-2.5 py-1 font-semibold whitespace-nowrap flex-shrink-0 backdrop-blur-md"
              style={{ 
                fontSize: '16px',
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
      
      {/* Chart Area - fills remaining space */}
      {/* In TV mode, show simplified static display instead of heavy Recharts */}
      <div className="flex-1 min-h-0 p-2 pb-1 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0">
          <LazyBrewChart 
            data={brew.sgData} 
            og={brew.originalGravity} 
            fg={brew.finalGravity} 
            singleView={true}
            events={brew.events}
            controllerId={brew.linked_controller_id}
            chartIndex={cardIndex}
          />
        </div>
        
        {/* Active Fermentation Session - compact view, px-1 to match stats px-3 (p-2 + px-1 = px-3) */}
        <div className="mt-1 flex-shrink-0 px-1">
          <ActiveFermentationSession 
            brewId={brew.id} 
            compact 
            preloadedSession={brew.fermentationSession}
            isAuthenticated={isAuthenticated}
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
            onSyncedDataClick={() => setSyncedDataOpen(true)}
          />
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
