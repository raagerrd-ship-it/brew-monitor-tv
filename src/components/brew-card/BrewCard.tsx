import { useMemo, memo, useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTvMode } from "@/contexts/TvModeContext";

import { LazyBrewChart } from "../brew-chart/LazyBrewChart";
import { BrewEventDialog } from "../BrewEventDialog";
import { ActiveFermentationSession } from "../fermentation";
import { Share2, TrendingUp, Plus, FlaskConical, PackageCheck, Snowflake, CheckCircle2, Printer, Flame, FileText, Play } from "lucide-react";
import { BatchReportButton } from "../BatchReportButton";
import { findDevicesForBrew } from "@/lib/brew-utils";
import { BrewCardProps } from "./types";
import { getStatusDisplayText, isBrewInactive } from "./utils";
import { GravityStat } from "./GravityStat";
import { AbvStat } from "./AbvStat";
import { TempStat } from "./TempStat";
import { AttenuationStat } from "./AttenuationStat";


import { SyncedDataDialog } from "./SyncedDataDialog";
import { PrintLabelDialog } from "../PrintLabelDialog";
import { StartFermentationSessionDialog } from "../fermentation";

// Fixed heights in pixels for consistent layout (optimized for 720p)
const CARD_HEADER_HEIGHT = 80;
const CARD_STATS_HEIGHT = 148;

/** Small icon for brew status badge */
function StatusIcon({ status }: { status: string }) {
  const cls = "h-3 w-3";
  switch (status) {
    case "Bryggning": return <Flame className={cls} />;
    case "Jäsning": return <FlaskConical className={cls} />;
    case "Konditionering": return <PackageCheck className={cls} />;
    case "Klar": return <CheckCircle2 className={cls} />;
    case "Coldcrash": return <Snowflake className={cls} />;
    default: return <FlaskConical className={cls} />;
  }
}

function BrewCardComponent({
  brew,
  updatedFields,
  isAuthenticated,
  pills,
  controllers,
  onShareBrew,
  onEventsChange,
  onControllerClick,
  
  cardIndex = 0,
  hasAlbumArtBackground = false,
  brewCount,
}: BrewCardProps) {
  const [syncedDataOpen, setSyncedDataOpen] = useState(false);
  const [printLabelOpen, setPrintLabelOpen] = useState(false);
  const [startSessionOpen, setStartSessionOpen] = useState(false);
  const [sessionExpanded, setSessionExpanded] = useState(false);
  const [smoothLines, setSmoothLines] = useState(true);
  const [labelExpanded, setLabelExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { isTvMode } = useTvMode();

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [menuOpen]);
  
  // Memoize expensive calculations
  const devices = useMemo(() => 
    findDevicesForBrew(brew, pills, controllers), 
    [brew.id, pills, controllers]
  );
  




  const statusText = useMemo(() => 
    getStatusDisplayText(brew), 
    [brew.status, brew.fermentationRate]
  );
  
  const isCompletedOrConditioning = brew.status === "Konditionering" || brew.status === "Klar";
  const isBrewing = brew.status === "Bryggning";
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
        <div className="flex items-center gap-2 h-full">
          {/* Label image thumbnail */}
          {brew.label_image_url && (
            <div 
              className="flex-shrink-0 rounded-lg overflow-hidden border border-white/10 bg-muted/30 animate-pulse cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
              style={{ width: '52px', height: '52px' }}
              onClick={() => setLabelExpanded(v => !v)}
            >
              <img
                src={brew.label_image_url}
                alt={`${brew.name} etikett`}
                className="h-full w-full object-cover"
                loading="lazy"
                onLoad={(e) => (e.currentTarget.parentElement as HTMLElement)?.classList.remove('animate-pulse')}
              />
            </div>
          )}
          {/* Title + subtitle column */}
          <div className="min-w-0 flex-1 flex flex-col justify-center gap-0.5">
            {/* Title row */}
            <div className="flex items-center gap-2">
              <h2 
                className="font-bold text-foreground leading-tight truncate tracking-tight flex-1 min-w-0"
                style={{ 
                  fontSize: '18px',
                  textShadow: '0 2px 8px hsl(0 0% 0% / 0.4)',
                  letterSpacing: '-0.02em'
                }}
              >
                {brew.name}
              </h2>
              {/* Status badge as menu trigger */}
              <div className="flex-shrink-0 relative" ref={menuRef}>
                <button
                  onClick={showInteractiveElements ? () => setMenuOpen(!menuOpen) : undefined}
                  className={`rounded-full px-2 py-0.5 font-semibold whitespace-nowrap backdrop-blur-md inline-flex items-center gap-1 transition-opacity ${showInteractiveElements ? 'cursor-pointer hover:opacity-80 active:opacity-60' : ''}`}
                  style={{ 
                    fontSize: '10px',
                    background: isCompletedOrConditioning 
                      ? "linear-gradient(135deg, hsl(var(--primary) / 0.25) 0%, hsl(var(--primary) / 0.1) 100%)" 
                      : isBrewing
                      ? "linear-gradient(135deg, hsl(30 90% 50% / 0.25) 0%, hsl(30 90% 50% / 0.1) 100%)"
                      : "linear-gradient(135deg, hsl(var(--ferment-green) / 0.25) 0%, hsl(var(--ferment-green) / 0.1) 100%)",
                    color: isCompletedOrConditioning ? "hsl(var(--primary))" : isBrewing ? "hsl(30 90% 55%)" : "hsl(var(--ferment-green))",
                    border: isCompletedOrConditioning
                      ? "1px solid hsl(var(--primary) / 0.3)" 
                      : isBrewing
                      ? "1px solid hsl(30 90% 50% / 0.4)"
                      : "1px solid hsl(var(--ferment-green) / 0.4)",
                    boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.1), inset 0 -1px 0 hsl(0 0% 0% / 0.05)",
                  }}
                >
                  <StatusIcon status={brew.status} />
                  {statusText}
                </button>
                {menuOpen && showInteractiveElements && (
                  <div
                    className="absolute right-0 top-7 z-50 flex flex-col gap-0.5 rounded-lg border border-border bg-card p-1.5 shadow-lg shadow-black/40 min-w-[140px]"
                    style={{ backdropFilter: 'blur(12px)' }}
                  >
                    {brew.batch_id.startsWith('custom_') && (
                      <div className="flex items-center gap-2 rounded px-2.5 py-1.5 text-xs text-muted-foreground w-full">
                        <span className="font-semibold">#{brew.batchNumber}</span>
                      </div>
                    )}
                    <button
                      className="flex items-center gap-2 rounded px-2.5 py-1.5 text-xs text-foreground hover:bg-accent transition-colors w-full text-left"
                      onClick={() => { setSmoothLines(!smoothLines); }}
                    >
                      <TrendingUp className={`h-3.5 w-3.5 ${smoothLines ? 'text-primary' : 'text-muted-foreground'}`} />
                      {smoothLines ? 'Raka linjer' : 'Mjuka linjer'}
                    </button>
                    <button
                      className="flex items-center gap-2 rounded px-2.5 py-1.5 text-xs text-foreground hover:bg-accent transition-colors w-full text-left"
                      onClick={() => { onShareBrew(brew); setMenuOpen(false); }}
                    >
                      <Share2 className="h-3.5 w-3.5" />
                      Dela
                    </button>
                    <BrewEventDialog
                      brewId={brew.id}
                      brewName={brew.name}
                      events={brew.events}
                      onEventsChange={onEventsChange}
                      trigger={
                        <button
                          className="flex items-center gap-2 rounded px-2.5 py-1.5 text-xs text-foreground hover:bg-accent transition-colors w-full text-left"
                          onClick={() => setMenuOpen(false)}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Händelser
                        </button>
                      }
                    />
                    <button
                      className="flex items-center gap-2 rounded px-2.5 py-1.5 text-xs text-foreground hover:bg-accent transition-colors w-full text-left"
                      onClick={() => { setPrintLabelOpen(true); setMenuOpen(false); }}
                    >
                      <Printer className="h-3.5 w-3.5" />
                      Skriv ut etikett
                    </button>
                    {isCompletedOrConditioning && (
                      <div onClick={() => setMenuOpen(false)}>
                        <BatchReportButton
                          brewId={brew.id}
                          brewName={brew.name}
                          style={brew.style}
                          og={brew.originalGravity}
                          fg={brew.finalGravity}
                          abv={brew.abv}
                          attenuation={brew.attenuation}
                          batchNumber={brew.batchNumber}
                          fermentationStart={brew.sgData?.[0]?.date ?? null}
                          status={brew.status}
                          controllerId={devices.controller?.controller_id ?? null}
                        />
                      </div>
                    )}
                    {brew.status === "Jäsning" && devices.controller && !brew.fermentationSession && (
                      <button
                        className="flex items-center gap-2 rounded px-2.5 py-1.5 text-xs text-foreground hover:bg-accent transition-colors w-full text-left"
                        onClick={() => { setStartSessionOpen(true); setMenuOpen(false); }}
                      >
                        <Play className="h-3.5 w-3.5" />
                        Starta jäsningsprofil
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            {/* Subtitle row - full width next to label */}
            <p 
              className="text-muted-foreground/70 truncate font-medium" 
              style={{ fontSize: '11px', letterSpacing: '0.02em' }}
            >
              {brew.batch_id.startsWith('custom_') ? (
                <>
                  {brew.style && brew.style !== "Okänd stil" ? <>{brew.style} <span className="opacity-40">·</span> </> : ""}{brew.lastUpdate}
                </>
              ) : (
                <>
                  {brew.style && brew.style !== "Okänd stil" ? <>{brew.style} <span className="opacity-40">·</span> </> : ""}
                  {brew.lastUpdate}
                  <span className="opacity-40"> · </span>
                  <span className="inline-flex items-center px-1.5 py-px rounded text-[9px] font-semibold tracking-wide" style={{
                    background: 'hsl(var(--primary) / 0.1)',
                    color: 'hsl(var(--primary) / 0.7)',
                    border: '1px solid hsl(var(--primary) / 0.15)',
                  }}>
                    #{brew.batchNumber}
                  </span>
                </>
              )}
              {(() => {
                if (isBrewInactive(brew.status)) return null;
                const batteryValue = brew.battery ?? devices.pill?.battery_level ?? null;
                if (batteryValue === null) return null;
                const isLowBattery = batteryValue < 20;
                return (
                  <>
                    <span className="opacity-40"> · </span>
                    <span style={{ color: isLowBattery ? 'hsl(0 70% 55%)' : undefined }}>
                      🔋 {batteryValue.toFixed(1)}%
                    </span>
                  </>
                );
              })()}
            </p>
          </div>
        </div>
      </div>
      
      {/* Chart Area - hidden when session is expanded */}
      {!sessionExpanded && (
        <div className="flex-1 min-h-0 p-2 pb-1 flex flex-col">
          <div className="flex-1 min-h-0 overflow-hidden">
            {labelExpanded && brew.label_image_url ? (
              <div
                className="w-full h-full flex items-center justify-center bg-black/20 rounded-lg cursor-pointer"
                onClick={() => setLabelExpanded(false)}
              >
                <img
                  src={brew.label_image_url}
                  alt={`${brew.name} etikett`}
                  className="max-h-full max-w-full object-contain rounded-lg"
                />
              </div>
            ) : (
              <LazyBrewChart 
                data={brew.sgData} 
                og={brew.originalGravity} 
                fg={brew.finalGravity} 
                singleView={true}
                events={brew.events}
                controllerId={devices.controller?.controller_id ?? null}
                chartIndex={cardIndex}
                brewId={brew.id}
                hasFermentationSession={!!brew.fermentationSession}
                lastUpdateRaw={brew.lastUpdateRaw}
                brewCount={brewCount}
                smoothLines={smoothLines}
                onSmoothLinesChange={setSmoothLines}
                brewStatus={brew.status}
              />
            )}
          </div>
        </div>
      )}
        
      {/* Active Fermentation Session */}
      <div className={`flex-shrink-0 px-3 overflow-visible ${sessionExpanded ? 'flex-1 py-2' : 'mt-1 px-3 pb-1'}`}>
        <ActiveFermentationSession 
          brewId={brew.id} 
          compact 
          preloadedSession={brew.fermentationSession}
          isAuthenticated={showInteractiveElements}
          currentSg={brew.currentSG}
          originalGravity={brew.originalGravity}
          sgData={brew.sgData}
          activityScore={brew.fermentationMetrics?.activity_score ?? null}
          fermentationPhase={brew.fermentationMetrics?.fermentation_phase ?? null}
          attenuation={brew.attenuation}
          onExpandChange={setSessionExpanded}
        />
      </div>

      {/* Stats Grid - hidden when session is expanded */}
      {!sessionExpanded && (
        <div className="px-3 py-1.5 flex-shrink-0" style={{ height: `${CARD_STATS_HEIGHT}px`, overflow: 'visible' }}>
          <div className="grid grid-cols-3 grid-rows-2 gap-1.5 h-full overflow-visible">
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
              onControllerClick={onControllerClick}
            />
            <AttenuationStat brew={brew} updatedFields={updatedFields} />
          </div>
        </div>
      )}
      
      {/* Synced Data Dialog for custom brews */}
      {brew.batch_id.startsWith('custom_') && (
        <SyncedDataDialog
          open={syncedDataOpen}
          onOpenChange={setSyncedDataOpen}
          brewName={brew.name}
          brewId={brew.id}
          controllerId={devices.controller?.controller_id ?? null}
        />
      )}
      
      {/* Print Label Dialog */}
      <PrintLabelDialog
        open={printLabelOpen}
        onOpenChange={setPrintLabelOpen}
        brew={brew}
      />

      {/* Start Fermentation Session Dialog */}
      {devices.controller && (
        <StartFermentationSessionDialog
          open={startSessionOpen}
          onOpenChange={setStartSessionOpen}
          preselectedControllerId={devices.controller.controller_id}
          preselectedBrewId={brew.id}
        />
      )}
    </Card>
  );
}

export const BrewCard = memo(BrewCardComponent);
