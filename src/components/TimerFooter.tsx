import { memo, useRef, useState, useEffect } from 'react';
import { Flame, Pause, AlertTriangle } from 'lucide-react';
import { useExternalTimer, TimerMilestone } from '@/hooks/use-external-timer';
import { useTvMode } from '@/contexts/TvModeContext';
import { useExternalUserSettings } from '@/hooks/use-external-user-settings';
import { cn } from '@/lib/utils';

// Export constant for use in layout calculations
export const TIMER_FOOTER_HEIGHT = 90; // pixels - compact 3-column layout for TV
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatTimeShort(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return remainingMins > 0 ? `${hours}h${remainingMins}'` : `${hours}h`;
  }
  return `${mins}'`;
}

interface TimelineProps {
  milestones: TimerMilestone[];
  totalSeconds: number;
  remainingSeconds: number;
  isMash: boolean;
  isTvMode: boolean;
}

const VisualTimeline = memo(function VisualTimeline({ milestones, totalSeconds, remainingSeconds, isMash, isTvMode }: TimelineProps) {
  if (!milestones.length || totalSeconds <= 0) return null;

  // Sort milestones by time descending (highest time = earliest in process)
  const sortedMilestones = [...milestones].sort((a, b) => b.time - a.time);
  
  // Calculate current progress position
  const progressPercent = totalSeconds > 0 ? ((totalSeconds - remainingSeconds) / totalSeconds) * 100 : 0;

  // Distribute markers evenly if all have same time (API issue workaround)
  const allSameTime = sortedMilestones.every(m => m.time === sortedMilestones[0]?.time);

  return (
    <div className="relative w-full h-full flex flex-col justify-center -translate-y-2">
      {/* Time labels row */}
      <div className="relative h-5 mb-1">
        {sortedMilestones.map((milestone, index) => {
          const position = allSameTime 
            ? (index / Math.max(1, sortedMilestones.length - 1)) * 100
            : totalSeconds > 0 
              ? ((totalSeconds - milestone.time) / totalSeconds) * 100 
              : 0;
          const isTriggered = milestone.triggered || milestone.time >= remainingSeconds;
          const isFirst = index === 0;
          const isLast = index === sortedMilestones.length - 1;
          
          return (
            <div
              key={`label-${index}`}
              className="absolute -translate-x-1/2"
              style={{ left: `${position}%` }}
            >
              <span className={cn(
                "text-sm font-semibold tabular-nums",
                isTriggered 
                  ? "text-green-400" 
                  : isMash 
                    ? "text-orange-200" 
                    : "text-foreground/80"
              )}>
                {formatTimeShort(milestone.time)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Track - larger for TV visibility */}
      <div className={cn(
        "relative h-4 rounded-full",
        isMash ? "bg-orange-900/80" : "bg-muted/70"
      )}>
        {/* Progress fill with gradient */}
        <div 
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-all duration-300",
            isMash 
              ? "bg-gradient-to-r from-orange-600 via-orange-500 to-orange-400" 
              : "bg-gradient-to-r from-primary/90 to-primary"
          )}
          style={{ width: `${Math.min(100, progressPercent)}%` }}
        />
        
        {/* Milestone markers - larger for TV */}
        {sortedMilestones.map((milestone, index) => {
          const position = allSameTime 
            ? (index / Math.max(1, sortedMilestones.length - 1)) * 100
            : totalSeconds > 0 
              ? ((totalSeconds - milestone.time) / totalSeconds) * 100 
              : 0;
          const isTriggered = milestone.triggered || milestone.time >= remainingSeconds;
          const isNext = !isTriggered && 
            (index === 0 || sortedMilestones.slice(0, index).every(m => m.triggered || m.time >= remainingSeconds));
          
          return (
            <div
              key={index}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10"
              style={{ left: `${position}%` }}
            >
              {/* Marker dot - 10px for TV visibility */}
              <div className={cn(
                "w-5 h-5 rounded-full border-2 transition-all",
                isTriggered 
                  ? "bg-green-500 border-green-300 shadow-[0_0_8px_rgba(34,197,94,0.6)]" 
                  : isNext
                    ? isMash 
                      ? cn("bg-orange-400 border-orange-200 ring-2 ring-orange-400/60 shadow-[0_0_12px_rgba(251,146,60,0.7)]", !isTvMode && "animate-pulse")
                      : cn("bg-primary border-primary-foreground ring-2 ring-primary/60 shadow-[0_0_12px_rgba(var(--primary),0.7)]", !isTvMode && "animate-pulse")
                    : isMash
                      ? "bg-orange-800 border-orange-600"
                      : "bg-muted-foreground/50 border-muted-foreground/30"
              )} />
            </div>
          );
        })}
      </div>
    </div>
  );
});

// MilestoneScrollRow removed - replaced by improved VisualTimeline for TV display

export const TimerFooter = memo(function TimerFooter() {
  const { isTvMode } = useTvMode();
  const timer = useExternalTimer();
  const { timerTvModeOnly, isLoading: settingsLoading } = useExternalUserSettings();
  
  // Track triggered milestones for attention notification
  const [triggeredAlert, setTriggeredAlert] = useState<{ label: string; time: number } | null>(null);
  const lastTriggeredRef = useRef<string | null>(null);

  const isMash = timer.label === 'Mäskschema';
  const isLowTime = timer.remainingSeconds < 60 && timer.remainingSeconds > 0;
  
  // Find the most recently triggered milestone (current step)
  // This is the milestone with the highest time that has been triggered
  const currentMilestone = timer.milestones
    .filter(m => m.triggered || m.time >= timer.remainingSeconds)
    .sort((a, b) => b.time - a.time)[0] || null;

  // Check if we should show based on TV mode setting
  const shouldShow = settingsLoading ? true : (timerTvModeOnly ? isTvMode : true);
  
  // Detect when a milestone just triggered (within 3 seconds of its time)
  useEffect(() => {
    if (!timer.milestones.length || !timer.isActive) return;
    
    // A milestone triggers when remainingSeconds passes below its time value
    const justTriggered = timer.milestones.find(m => {
      // Check if we're within 3 seconds AFTER passing the milestone time
      const passed = timer.remainingSeconds < m.time;
      const justPassed = timer.remainingSeconds >= m.time - 3;
      const notAlreadyTriggered = m.label !== lastTriggeredRef.current;
      return passed && justPassed && notAlreadyTriggered;
    });
    
    if (justTriggered) {
      lastTriggeredRef.current = justTriggered.label;
      setTriggeredAlert({ label: justTriggered.label, time: Date.now() });
      
      // For kok (not mash): Auto-dismiss after 30 seconds
      // For mash: Keep alert visible until pausedByMilestone becomes false
      if (!isMash) {
        setTimeout(() => {
          setTriggeredAlert(null);
        }, 30000);
      }
    }
  }, [timer.remainingSeconds, timer.milestones, timer.isActive, isMash]);

  // For mash: Dismiss alert when pausedByMilestone becomes false (acknowledged)
  // But don't dismiss if it was just triggered (within 500ms) - allows test trigger to work
  useEffect(() => {
    if (isMash && triggeredAlert && !timer.pausedByMilestone && !timer.isPaused) {
      const timeSinceTriggered = Date.now() - triggeredAlert.time;
      if (timeSinceTriggered > 500) {
        // Timer resumed, dismiss the alert
        setTriggeredAlert(null);
      }
    }
  }, [isMash, triggeredAlert, timer.pausedByMilestone, timer.isPaused]);

  if (!shouldShow || !timer.isActive) {
    return null;
  }

  // Check if next milestone is imminent (less than 30 seconds)
  const isNextMilestoneImminent = timer.timeToNextMilestone !== null && timer.timeToNextMilestone <= 30 && timer.timeToNextMilestone > 0;

  return (
    <>
      {/* Attention-grabbing alert overlay when milestone triggers */}
      {triggeredAlert && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at center, rgba(234, 88, 12, 0.25) 0%, rgba(0,0,0,0.85) 100%)',
            animation: 'pulse-bg 1.5s ease-in-out infinite alternate',
          }}
        >
          {/* Card with improved layout */}
          <div 
            className="flex flex-col items-center px-16 py-10 rounded-2xl max-w-[90vw]"
            style={{
              background: 'linear-gradient(145deg, hsl(24 90% 20%) 0%, hsl(20 95% 15%) 100%)',
              border: '2px solid hsl(24 90% 40% / 0.6)',
              boxShadow: '0 0 60px 10px rgba(234, 88, 12, 0.4), 0 0 120px 30px rgba(234, 88, 12, 0.2), inset 0 1px 0 rgba(255,255,255,0.1)',
              animation: 'scale-pulse 0.4s ease-out',
            }}
          >
            {/* Top badge */}
            <div 
              className="flex items-center gap-3 px-6 py-2 rounded-full mb-6"
              style={{
                background: 'linear-gradient(135deg, hsl(24 95% 50%) 0%, hsl(30 100% 45%) 100%)',
                boxShadow: '0 0 20px rgba(251, 146, 60, 0.5)',
              }}
            >
              <AlertTriangle className="w-6 h-6 text-white" />
              <span className="text-white text-lg font-bold uppercase tracking-widest">Dags nu!</span>
            </div>
            
            {/* Main action text */}
            <div className="text-orange-100 text-5xl md:text-7xl font-bold text-center leading-tight">
              {triggeredAlert.label.replace(/🔥\s*/g, '')}
            </div>
            
            {/* Subtle instruction */}
            <div className="text-orange-300/80 text-lg mt-4 font-medium">
              Utför detta steg
            </div>
          </div>
        </div>
      )}

      {/* Main footer - 3 column grid layout for TV */}
      <div 
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50 border-t",
          isMash 
            ? "bg-gradient-to-r from-orange-950 via-orange-900 to-orange-950 border-orange-700/60" 
            : "bg-gradient-to-r from-background via-card to-background border-border"
        )}
        style={{
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          height: `${TIMER_FOOTER_HEIGHT}px`,
        }}
      >
        {/* 3-column grid: Current/Next Steps | Timeline | Time (auto-width) */}
        <div className="grid grid-cols-[minmax(200px,1fr)_3fr_auto] h-full">
          
          {/* LEFT COLUMN: Current Step + Next Step */}
          <div className={cn(
            "flex flex-col justify-center px-4 border-r gap-0.5",
            isMash ? "border-orange-700/40" : "border-border/50"
          )}>
            {/* Current Step - show last triggered milestone */}
            {currentMilestone && (
              <div className="flex items-center gap-2">
                <span className={cn(
                  "text-xs uppercase tracking-wide flex-shrink-0",
                  isMash ? "text-green-400/80" : "text-green-500/80"
                )}>
                  Nu:
                </span>
                <span className={cn(
                  "text-sm font-medium truncate",
                  isMash ? "text-green-300" : "text-green-400"
                )}>
                  {currentMilestone.label.replace(/🔥\s*/g, '')}
                </span>
              </div>
            )}
            
            {/* Next Step */}
            <div className="flex items-center gap-2">
              <span className={cn(
                "text-xs uppercase tracking-wide flex-shrink-0",
                isMash ? "text-orange-400/80" : "text-muted-foreground"
              )}>
                Nästa:
              </span>
              {timer.nextMilestone ? (
                <div className="flex items-center gap-1.5 overflow-hidden">
                  <Flame className={cn(
                    "w-4 h-4 flex-shrink-0",
                    isNextMilestoneImminent 
                      ? "text-yellow-400 animate-pulse" 
                      : isMash 
                        ? "text-orange-400" 
                        : "text-primary"
                  )} />
                  <div className="overflow-hidden max-w-[200px] relative">
                    {/* Disable seamless marquee in TV mode to prevent performance issues on Chromecast */}
                    <div className={cn("inline-flex whitespace-nowrap", !isTvMode && "animate-marquee-seamless")}>
                      <span className={cn(
                        "text-base font-semibold px-4",
                        isNextMilestoneImminent 
                          ? "text-yellow-300" 
                          : isMash 
                            ? "text-orange-100" 
                            : "text-foreground"
                      )}>
                        {timer.nextMilestone.label.replace(/🔥\s*/g, '')}
                      </span>
                      <span className={cn(
                        "text-base font-semibold px-4",
                        isNextMilestoneImminent 
                          ? "text-yellow-300" 
                          : isMash 
                            ? "text-orange-100" 
                            : "text-foreground"
                      )}>
                        {timer.nextMilestone.label.replace(/🔥\s*/g, '')}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <span className={cn(
                  "text-base font-semibold",
                  isMash ? "text-green-400" : "text-green-500"
                )}>
                  ✓ Klart!
                </span>
              )}
            </div>
          </div>

          {/* CENTER COLUMN: Visual Timeline */}
          <div className="flex items-center px-6">
            {timer.milestones.length > 0 ? (
              <VisualTimeline 
                milestones={timer.milestones}
                totalSeconds={timer.totalSeconds}
                remainingSeconds={timer.remainingSeconds}
                isMash={isMash}
                isTvMode={isTvMode}
              />
            ) : (
              <div className={cn(
                "w-full h-4 rounded-full",
                isMash ? "bg-orange-900/50" : "bg-muted/50"
              )} />
            )}
          </div>

          {/* RIGHT COLUMN: Time Display */}
          <div className={cn(
            "flex flex-col justify-center items-end px-4 border-l",
            isMash ? "border-orange-700/40" : "border-border/50"
          )}>
            {timer.isPaused && (
              <div className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded text-xs mb-1",
                isMash 
                  ? "bg-orange-800/60 text-orange-200" 
                  : "bg-muted text-muted-foreground"
              )}>
                <Pause className="w-3 h-3" />
                PAUSAD
              </div>
            )}
            
            {/* Time to next milestone - PRIMARY (large for TV) */}
            {timer.timeToNextMilestone !== null && timer.timeToNextMilestone > 0 && (
              <div className="flex items-baseline gap-2">
                <span className={cn(
                  "text-sm",
                  isMash ? "text-orange-400/80" : "text-muted-foreground"
                )}>
                  om
                </span>
                <span 
                  className={cn(
                    "font-mono font-bold tabular-nums text-3xl",
                    isNextMilestoneImminent 
                      ? "text-yellow-300 animate-pulse drop-shadow-[0_0_8px_rgba(253,224,71,0.5)]" 
                      : isMash 
                        ? "text-orange-100" 
                        : "text-foreground"
                  )}
                >
                  {formatTime(timer.timeToNextMilestone)}
                </span>
              </div>
            )}
            
            {/* Total remaining time - secondary (clickable for test) */}
            <div 
              onClick={() => {
                console.log('Test trigger clicked!');
                const testLabel = timer.nextMilestone?.label || 'Test Milestone';
                console.log('Setting alert with label:', testLabel);
                setTriggeredAlert({ label: testLabel, time: Date.now() });
                setTimeout(() => {
                  console.log('Clearing alert');
                  setTriggeredAlert(null);
                }, 5000);
              }}
              className={cn(
                "font-mono tabular-nums text-base cursor-pointer hover:opacity-80 transition-opacity",
                isLowTime && "animate-pulse text-red-400",
                !isLowTime && (isMash ? "text-orange-400/70" : "text-muted-foreground")
              )}
            >
              {formatTime(timer.remainingSeconds)} totalt
            </div>
          </div>
        </div>
      </div>
    </>
  );
});
