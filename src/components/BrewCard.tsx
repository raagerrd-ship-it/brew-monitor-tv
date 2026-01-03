import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BrewChart } from "./BrewChart";
import { BrewEventDialog } from "./BrewEventDialog";
import { Share2 } from "lucide-react";
import { BrewData, PillData, TempController } from "@/types/brew";

interface BrewCardProps {
  brew: BrewData;
  updatedFields: Record<string, Record<string, boolean>>;
  isAuthenticated: boolean;
  pills: PillData[];
  controllers: TempController[];
  onShareBrew: (brew: BrewData) => void;
  onEventsChange: () => void;
  onDeviceLinkOpen: (brewId: string, brewName: string, controllerId: string | null, pillId: string | null) => void;
}

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

  // Helper function to find matching pill/controller for a brew
  const findDevicesForBrew = (): { pill: PillData | null; controller: TempController | null } => {
    // First, check for manual connections
    if (brew.linked_controller_id) {
      const manualController = controllers.find(c => c.controller_id === brew.linked_controller_id) || null;
      const manualPill = brew.linked_pill_id 
        ? pills.find(p => p.pill_id === brew.linked_pill_id) || null
        : null;
      
      if (manualController || manualPill) {
        return { pill: manualPill, controller: manualController };
      }
    }

    // Fallback to automatic matching
    let matchingPill: PillData | null = null;
    let matchingController: TempController | null = null;

    // Try to match by color name in brew name
    const brewNameLower = brew.name.toLowerCase();
    const colorKeywords = ['röd', 'red', 'blå', 'blue', 'grön', 'green', 'gul', 'gyllene', 'guld', 'golden', 'yellow', 'lila', 'purple', 'rosa', 'pink', 'orange', 'cyan', 'lime', 'amber', 'bärnsten', 'turkos', 'teal', 'indigo', 'violet', 'violett', 'fuchsia', 'rose', 'himmel', 'sky', 'smaragd', 'emerald'];

    // Find color keywords in brew name
    const brewColors = colorKeywords.filter(color => brewNameLower.includes(color));

    // Try to match pill by color
    if (brewColors.length > 0) {
      matchingPill = pills.find(pill => {
        const pillNameLower = pill.name.toLowerCase();
        return brewColors.some(color => pillNameLower.includes(color));
      }) || null;
    }

    // Try to match controller by color  
    if (brewColors.length > 0) {
      matchingController = controllers.find(ctrl => {
        const ctrlNameLower = ctrl.name.toLowerCase();
        return brewColors.some(color => ctrlNameLower.includes(color));
      }) || null;
    }

    // If no color match, try temperature matching (±3°C tolerance)
    if (!matchingController && !matchingPill) {
      const brewTemp = brew.currentTemp;
      
      // Try to match controller by temperature
      matchingController = controllers.find(ctrl => {
        if (ctrl.pill_temp !== null) {
          return Math.abs(ctrl.pill_temp - brewTemp) <= 3;
        }
        if (ctrl.current_temp !== null) {
          return Math.abs(ctrl.current_temp - brewTemp) <= 3;
        }
        return false;
      }) || null;

      // If controller matched, use its linked pill
      if (matchingController && matchingController.linked_pill_id) {
        matchingPill = pills.find(p => p.pill_id === matchingController.linked_pill_id) || null;
      }
    }

    // If we found a controller but no pill, check if controller has a linked pill
    if (matchingController && !matchingPill && matchingController.linked_pill_id) {
      matchingPill = pills.find(p => p.pill_id === matchingController.linked_pill_id) || null;
    }

    return { pill: matchingPill, controller: matchingController };
  };

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
                background: (brew.status === "Konditionering" || brew.status === "Klar") 
                  ? "linear-gradient(135deg, hsl(var(--primary) / 0.25) 0%, hsl(var(--primary) / 0.1) 100%)" 
                  : "linear-gradient(135deg, hsl(var(--ferment-green) / 0.25) 0%, hsl(var(--ferment-green) / 0.1) 100%)",
                color: (brew.status === "Konditionering" || brew.status === "Klar") ? "hsl(var(--primary))" : "hsl(var(--ferment-green))",
                border: (brew.status === "Konditionering" || brew.status === "Klar")
                  ? "1px solid hsl(var(--primary) / 0.3)" 
                  : "1px solid hsl(var(--ferment-green) / 0.4)",
                boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.1), inset 0 -1px 0 hsl(0 0% 0% / 0.05)",
                textShadow: "none"
              }}
            >
              {brew.status === "Jäsning" && brew.sgData.length > 0 ? (
                (() => {
                  const sortedData = [...brew.sgData].sort((a, b) => 
                    new Date(a.date).getTime() - new Date(b.date).getTime()
                  );
                  const firstDate = new Date(sortedData[0].date);
                  const daysSinceStart = Math.floor(
                    (new Date().getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)
                  );
                  return `${brew.status} dag ${daysSinceStart}`;
                })()
              ) : brew.status}
            </span>
          </div>
        </div>
      </div>
      
      {/* Chart Area - 58% */}
      <div className="h-[58%] p-2 pb-1 flex-shrink-0">
        <BrewChart 
          data={brew.sgData} 
          og={brew.originalGravity} 
          fg={brew.finalGravity} 
          singleView={true}
          events={brew.events}
        />
      </div>

      {/* Stats Grid - 32% */}
      <div className="h-[32%] p-2 pt-1 pb-2 flex-shrink-0">
        <div className="grid grid-cols-3 gap-3 h-full">
          {/* SG - Large Featured Card */}
          <div 
            className={`col-span-1 row-span-2 rounded-xl p-1 flex flex-col items-center justify-center gap-0.5 transition-all duration-1000 relative overflow-hidden ${
              brew.coldcrashAcknowledged 
                ? 'bg-green-500/10 border border-green-500/30' 
                : 'backdrop-blur-sm border border-primary/20'
            } ${
              updatedFields[brew.batch_id]?.sg ? 'shadow-[0_0_25px_hsl(var(--primary)/0.5)] border-primary/50' : ''
            }`}
            style={{ 
              containerType: 'size',
              background: brew.coldcrashAcknowledged 
                ? 'linear-gradient(135deg, hsl(120 50% 20% / 0.15) 0%, hsl(120 40% 15% / 0.1) 100%)'
                : 'linear-gradient(135deg, hsl(38 90% 60% / 0.08) 0%, hsl(222 18% 15% / 0.6) 100%)',
              boxShadow: updatedFields[brew.batch_id]?.sg 
                ? undefined 
                : '0 6px 20px hsl(222 30% 3% / 0.6), 0 3px 8px hsl(222 30% 3% / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.06)'
            }}
          >
            <p className="text-muted-foreground/60 tracking-wide flex items-center justify-center z-10 px-1 font-normal" style={{ fontSize: 'max(12px, min(2.2vh, 1.5vw))' }}>Gravity</p>
            <p 
              className={`font-bold text-primary leading-none flex items-center justify-center z-10 px-1 tabular-nums ${updatedFields[brew.batch_id]?.sg ? 'animate-value-shimmer' : ''}`}
              style={{ 
                fontSize: 'max(32px, min(6vh, 3vw))',
                textShadow: '0 0 20px hsl(var(--primary) / 0.4)'
              }}
            >
              {brew.currentSG.toFixed(3)}
            </p>
            <div className="text-muted-foreground/70 mt-0.5 space-y-0.5 z-10 text-center px-1 w-full">
              <p className="tabular-nums truncate" style={{ fontSize: 'max(10px, min(1.5vh, 1.1vw))' }}>OG: {brew.originalGravity.toFixed(3)}</p>
              <p className="tabular-nums truncate" style={{ fontSize: 'max(10px, min(1.5vh, 1.1vw))' }}>FG: {brew.finalGravity.toFixed(3)}</p>
              <p className="font-medium truncate" style={{ fontSize: 'max(10px, min(1.5vh, 1.1vw))' }}>
                {brew.fermentationRate !== null ? (
                  <>{brew.fermentationRate > 0 ? '-' : '+'}{Math.abs(brew.fermentationRate).toFixed(3)}/dygn</>
                ) : (
                  <>Beräknar...</>
                )}
              </p>
            </div>
          </div>

          {/* ABV */}
          <div 
            className={`rounded-xl p-1.5 pr-3 flex flex-col items-start justify-center gap-0 backdrop-blur-sm border border-secondary/20 transition-all duration-1000 relative overflow-hidden ${
              updatedFields[brew.batch_id]?.abv ? 'shadow-[0_0_25px_hsl(var(--secondary)/0.5)] border-secondary/50' : ''
            }`}
            style={{ 
              containerType: 'size',
              background: 'linear-gradient(135deg, hsl(45 80% 55% / 0.06) 0%, hsl(222 18% 15% / 0.5) 100%)',
              boxShadow: updatedFields[brew.batch_id]?.abv 
                ? undefined 
                : '0 6px 20px hsl(222 30% 3% / 0.6), 0 3px 8px hsl(222 30% 3% / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.06)'
            }}
          >
            <div className="absolute top-1/2 -translate-y-1/2 opacity-10" style={{ width: '60%', height: '60%', right: '-15%' }}>
              <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
                <defs>
                  <linearGradient id={`abvFill-${brew.batch_id}`} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--secondary))" stopOpacity="0.05"/>
                    <stop offset={`${100 - Math.min((brew.abv / 10) * 100, 100)}%`} stopColor="hsl(var(--secondary))" stopOpacity="0.05"/>
                    <stop offset={`${100 - Math.min((brew.abv / 10) * 100, 100)}%`} stopColor="hsl(var(--secondary))" stopOpacity="0.6"/>
                    <stop offset="100%" stopColor="hsl(var(--secondary))" stopOpacity="0.6"/>
                  </linearGradient>
                </defs>
                {/* Wine glass with fill - thinner strokes */}
                <path d="M8 2l-1 12c0 2 2 4 5 4s5-2 5-4L16 2z" stroke="hsl(var(--secondary))" strokeWidth="0.75" fill={`url(#abvFill-${brew.batch_id})`}/>
                <line x1="12" y1="18" x2="12" y2="22" stroke="hsl(var(--secondary))" strokeWidth="0.75"/>
                <line x1="9" y1="22" x2="15" y2="22" stroke="hsl(var(--secondary))" strokeWidth="0.75"/>
              </svg>
            </div>
            <p className="text-muted-foreground/60 tracking-wide z-10 pl-2 font-normal" style={{ fontSize: 'max(11px, min(1.8vh, 1vw))' }}>Abv</p>
            <p 
              className={`font-bold text-secondary leading-none z-10 pl-2 ${updatedFields[brew.batch_id]?.abv ? 'animate-value-shimmer' : ''}`}
              style={{ 
                fontSize: 'max(28px, min(5.5vh, 2.5vw))',
                textShadow: '0 0 15px hsl(var(--secondary) / 0.3)'
              }}
            >
              {brew.abv.toFixed(1)}%
            </p>
          </div>

          {/* Temp */}
          {(() => {
            const { pill, controller } = findDevicesForBrew();
            const tempColor = pill?.color || 'hsl(var(--primary))';
            
            const isInactive = brew.status === "Konditionering" || brew.status === "Klar";
            
            return (
              <div 
                className={`rounded-xl p-1.5 pr-3 flex flex-col items-start justify-center gap-0 relative overflow-hidden backdrop-blur-sm ${isAuthenticated ? 'cursor-pointer hover:opacity-80' : ''} ${isInactive ? 'opacity-40' : ''}`}
                style={{ 
                  containerType: 'size',
                  borderColor: `${tempColor}33`,
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  background: `linear-gradient(135deg, ${tempColor}08 0%, hsl(222 18% 15% / 0.5) 100%)`,
                  boxShadow: updatedFields[brew.batch_id]?.temp 
                    ? `0 0 25px ${tempColor}66`
                    : '0 6px 20px hsl(222 30% 3% / 0.6), 0 3px 8px hsl(222 30% 3% / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.06)',
                  ...(updatedFields[brew.batch_id]?.temp && {
                    borderColor: `${tempColor}66`
                  })
                }}
                onClick={() => {
                  if (isAuthenticated) {
                    onDeviceLinkOpen(
                      brew.batch_id,
                      brew.name,
                      brew.linked_controller_id || null,
                      brew.linked_pill_id || null
                    );
                  }
                }}
                title={isAuthenticated ? "Klicka för att koppla enheter" : undefined}
              >
                <div className="absolute top-1/2 -translate-y-1/2 opacity-10" style={{ width: '60%', height: '60%', right: '-15%' }}>
                  <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
                    {/* Thermometer outline - thinner stroke */}
                    <path 
                      d="M14 4v10a4 4 0 1 1-4 0V4a2 2 0 1 1 4 0Z" 
                      stroke={tempColor}
                      strokeWidth="0.75" 
                      fill="none"
                    />
                    {/* Thermometer fill - calculate based on 0-30 degrees */}
                    <defs>
                      <clipPath id={`thermo-clip-${brew.batch_id}`}>
                        <path d="M14 4v10a4 4 0 1 1-4 0V4a2 2 0 1 1 4 0Z" />
                      </clipPath>
                    </defs>
                    <rect 
                      x="8" 
                      y={`${24 - (Math.min(Math.max(brew.currentTemp, 0), 30) / 30) * 20}`}
                      width="8" 
                      height="20" 
                      fill={tempColor}
                      clipPath={`url(#thermo-clip-${brew.batch_id})`}
                      className="transition-all duration-500"
                      opacity="0.6"
                    />
                  </svg>
                </div>
                <p className="text-muted-foreground/60 tracking-wide z-10 pl-2 font-normal" style={{ fontSize: 'max(11px, min(1.8vh, 1vw))' }}>
                  Temp{controller && controller.target_temp !== null && ` (${controller.target_temp.toFixed(0)}°)`}
                </p>
                <p 
                  className={`font-bold leading-none z-10 pl-2 ${updatedFields[brew.batch_id]?.temp ? 'animate-value-shimmer' : ''}`}
                  style={{ 
                    color: tempColor,
                    fontSize: 'max(28px, min(5.5vh, 2.5vw))',
                    textShadow: `0 0 15px ${tempColor}40`
                  }}
                >
                  {brew.currentTemp}°
                </p>
              </div>
            );
          })()}

          {/* Utjäsning */}
          <div 
            className={`rounded-xl p-1.5 pr-3 flex flex-col items-start justify-center gap-0 backdrop-blur-sm border border-ferment-green/20 transition-all duration-1000 relative overflow-hidden ${
              updatedFields[brew.batch_id]?.attenuation ? 'shadow-[0_0_25px_hsl(var(--ferment-green)/0.5)] border-ferment-green/50' : ''
            }`}
            style={{ 
              containerType: 'size',
              background: 'linear-gradient(135deg, hsl(120 50% 45% / 0.06) 0%, hsl(222 18% 15% / 0.5) 100%)',
              boxShadow: updatedFields[brew.batch_id]?.attenuation 
                ? undefined 
                : '0 6px 20px hsl(222 30% 3% / 0.6), 0 3px 8px hsl(222 30% 3% / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.06)'
            }}
          >
            {(() => {
              const isInactiveAttenuation = brew.status === "Konditionering" || brew.status === "Klar";
              return (
                <div className="absolute top-1/2 -translate-y-1/2 opacity-10" style={{ width: '55%', height: '55%', right: '-12%' }}>
                  <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
                    {/* Rising bubbles - thinner strokes, gradient opacity */}
                    <circle cx="14" cy="22" r="1" stroke="hsl(var(--ferment-green))" strokeWidth="0.5" fill="none" opacity={brew.attenuation >= 80 ? "0.7" : "0.15"} className={isInactiveAttenuation ? '' : 'animate-pulse'} style={{ animationDelay: '0.4s' }} />
                    <circle cx="8" cy="20" r="1.2" stroke="hsl(var(--ferment-green))" strokeWidth="0.6" fill="none" opacity={brew.attenuation >= 80 ? "0.7" : "0.15"} className={isInactiveAttenuation ? '' : 'animate-pulse'} />
                    <circle cx="18" cy="20" r="1.8" stroke="hsl(var(--ferment-green))" strokeWidth="0.6" fill="none" opacity={brew.attenuation >= 70 ? "0.6" : "0.15"} className={isInactiveAttenuation ? '' : 'animate-pulse'} style={{ animationDelay: '0.5s' }} />
                    <circle cx="8" cy="18" r="2.5" stroke="hsl(var(--ferment-green))" strokeWidth="0.75" fill="none" opacity={brew.attenuation >= 60 ? "0.6" : "0.15"} className={isInactiveAttenuation ? '' : 'animate-pulse'} />
                    <circle cx="10" cy="16" r="1.3" stroke="hsl(var(--ferment-green))" strokeWidth="0.6" fill="none" opacity={brew.attenuation >= 50 ? "0.5" : "0.15"} className={isInactiveAttenuation ? '' : 'animate-pulse'} style={{ animationDelay: '0.8s' }} />
                    <circle cx="16" cy="14" r="3" stroke="hsl(var(--ferment-green))" strokeWidth="0.75" fill="none" opacity={brew.attenuation >= 40 ? "0.5" : "0.15"} className={isInactiveAttenuation ? '' : 'animate-pulse'} style={{ animationDelay: '0.3s' }} />
                    <circle cx="6" cy="12" r="1.5" stroke="hsl(var(--ferment-green))" strokeWidth="0.6" fill="none" opacity={brew.attenuation >= 30 ? "0.4" : "0.15"} className={isInactiveAttenuation ? '' : 'animate-pulse'} style={{ animationDelay: '0.2s' }} />
                    <circle cx="16" cy="10" r="0.8" stroke="hsl(var(--ferment-green))" strokeWidth="0.5" fill="none" opacity={brew.attenuation >= 20 ? "0.35" : "0.15"} className={isInactiveAttenuation ? '' : 'animate-pulse'} style={{ animationDelay: '0.1s' }} />
                    <circle cx="12" cy="8" r="2" stroke="hsl(var(--ferment-green))" strokeWidth="0.75" fill="none" opacity={brew.attenuation >= 10 ? "0.35" : "0.15"} className={isInactiveAttenuation ? '' : 'animate-pulse'} style={{ animationDelay: '0.6s' }} />
                    <circle cx="9" cy="6" r="1.2" stroke="hsl(var(--ferment-green))" strokeWidth="0.5" fill="none" opacity={brew.attenuation >= 5 ? "0.3" : "0.15"} className={isInactiveAttenuation ? '' : 'animate-pulse'} style={{ animationDelay: '0.7s' }} />
                  </svg>
                </div>
              );
            })()}
            <p className="text-muted-foreground/60 tracking-wide z-10 pl-2 font-normal" style={{ fontSize: 'max(11px, min(1.8vh, 1vw))' }}>Utjäsning</p>
            <p 
              className={`font-bold text-ferment-green leading-none z-10 pl-2 ${updatedFields[brew.batch_id]?.attenuation ? 'animate-value-shimmer' : ''}`}
              style={{ 
                fontSize: 'max(28px, min(5.5vh, 2.5vw))',
                textShadow: '0 0 15px hsl(var(--ferment-green) / 0.3)'
              }}
            >
              {brew.attenuation}%
            </p>
          </div>

          {/* Batteri */}
          {(() => {
            const { pill } = findDevicesForBrew();
            const batteryColor = pill?.color || 'hsl(var(--primary))';
            const isInactive = brew.status === "Konditionering" || brew.status === "Klar";
            
            return (
              <div 
                className={`rounded-xl p-1.5 pr-3 flex flex-col items-start justify-center gap-0 relative overflow-hidden backdrop-blur-sm ${isInactive ? 'opacity-40' : ''}`}
                style={{ 
                  containerType: 'size',
                  borderColor: `${batteryColor}33`,
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  background: `linear-gradient(135deg, ${batteryColor}05 0%, hsl(222 18% 15% / 0.5) 100%)`,
                  boxShadow: updatedFields[brew.batch_id]?.battery 
                    ? `0 0 25px ${batteryColor}66` 
                    : '0 6px 20px hsl(222 30% 3% / 0.6), 0 3px 8px hsl(222 30% 3% / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.06)'
                }}
              >
                <div className="absolute top-1/2 -translate-y-1/2 opacity-10" style={{ width: '55%', height: '55%', right: '-12%' }}>
                  <svg viewBox="0 0 24 24" fill="none" className="w-full h-full" style={{ transform: 'rotate(-90deg)' }}>
                    {/* Battery outline - thinner stroke */}
                    <rect x="2" y="6" width="18" height="12" rx="2" stroke={batteryColor} strokeWidth="0.75" fill="none"/>
                    <path d="M22 9v6" stroke={batteryColor} strokeWidth="0.75" strokeLinecap="round"/>
                    {/* Battery fill */}
                    {brew.battery !== null && (
                      <rect 
                        x="4" 
                        y="8" 
                        width={`${(brew.battery / 100) * 14}`} 
                        height="8" 
                        rx="1" 
                        fill={batteryColor}
                        className="transition-all duration-500"
                        opacity="0.6"
                      />
                    )}
                  </svg>
                </div>
                <p className="text-muted-foreground/60 tracking-wide z-10 pl-2 font-normal" style={{ fontSize: 'max(11px, min(1.8vh, 1vw))' }}>Batteri</p>
                <p 
                  className={`font-bold leading-none z-10 pl-2 ${updatedFields[brew.batch_id]?.battery ? 'animate-value-shimmer' : ''} ${!isInactive && brew.battery !== null && brew.battery < 20 ? 'animate-battery-pulse' : ''}`}
                  style={{ 
                    fontSize: 'max(28px, min(5.5vh, 2.5vw))',
                    color: !isInactive && brew.battery !== null && brew.battery < 20 ? 'hsl(0 70% 50%)' : batteryColor,
                    textShadow: !isInactive && brew.battery !== null && brew.battery < 20 ? '0 0 15px hsl(0 70% 50% / 0.4)' : `0 0 15px ${batteryColor}30`
                  }}
                >
                  {isInactive ? "--" : (brew.battery !== null ? `${brew.battery}%` : "--")}
                </p>
              </div>
            );
          })()}
        </div>
      </div>
    </Card>
  );
}
