import { memo, useMemo, useRef, useState, useEffect } from 'react';
import { ChefHat, Flame, Pause, Check, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { useExternalTimer, TimerMilestone } from '@/hooks/use-external-timer';
import { useTvMode } from '@/contexts/TvModeContext';
import { useExternalUserSettings } from '@/hooks/use-external-user-settings';
import { cn } from '@/lib/utils';

// Export constant for use in layout calculations
export const TIMER_FOOTER_HEIGHT = 145; // pixels
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
}

const VisualTimeline = memo(function VisualTimeline({ milestones, totalSeconds, remainingSeconds, isMash }: TimelineProps) {
  if (!milestones.length || totalSeconds <= 0) return null;

  // Sort milestones by time descending (highest time = earliest in process)
  const sortedMilestones = [...milestones].sort((a, b) => b.time - a.time);
  
  // Calculate current progress position
  const progressPercent = totalSeconds > 0 ? ((totalSeconds - remainingSeconds) / totalSeconds) * 100 : 0;

  // Distribute markers evenly if all have same time (API issue workaround)
  const allSameTime = sortedMilestones.every(m => m.time === sortedMilestones[0]?.time);

  return (
    <div className="relative w-full py-1">
      {/* Timeline track with time labels */}
      <div className="relative pt-6 pb-2">
        {/* Time labels above track */}
        {sortedMilestones.map((milestone, index) => {
          // If all same time, distribute evenly; otherwise use actual position
          const position = allSameTime 
            ? (index / Math.max(1, sortedMilestones.length - 1)) * 100
            : totalSeconds > 0 
              ? ((totalSeconds - milestone.time) / totalSeconds) * 100 
              : 0;
          const isTriggered = milestone.triggered || milestone.time >= remainingSeconds;
          
          // First label at left edge, last at right edge, others clamped
          const isFirst = index === 0;
          const isLast = index === sortedMilestones.length - 1;
          
          return (
            <div
              key={`label-${index}`}
              className={cn(
                "absolute top-0",
                isFirst ? "translate-x-0" : isLast ? "-translate-x-full" : "-translate-x-1/2"
              )}
              style={{ left: `${isFirst ? 0 : isLast ? 100 : Math.max(10, Math.min(90, position))}%` }}
            >
              <span className={cn(
                "text-xs font-medium tabular-nums",
                isTriggered 
                  ? "text-green-400" 
                  : isMash 
                    ? "text-orange-300" 
                    : "text-muted-foreground"
              )}>
                {formatTimeShort(milestone.time)}
              </span>
            </div>
          );
        })}

        {/* Track */}
        <div className={cn(
          "relative h-2.5 rounded-full",
          isMash ? "bg-orange-900/70" : "bg-muted/60"
        )}>
          {/* Progress fill */}
          <div 
            className={cn(
              "absolute inset-y-0 left-0 rounded-full transition-all duration-300",
              isMash 
                ? "bg-gradient-to-r from-orange-600 to-orange-400" 
                : "bg-gradient-to-r from-primary/80 to-primary"
            )}
            style={{ width: `${Math.min(100, progressPercent)}%` }}
          />
          
          {/* Milestone markers on track */}
          {sortedMilestones.map((milestone, index) => {
            // If all same time, distribute evenly
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
                {/* Marker dot */}
                <div className={cn(
                  "w-4 h-4 rounded-full border-2 transition-all shadow-sm",
                  isTriggered 
                    ? "bg-green-500 border-green-400" 
                    : isNext
                      ? isMash 
                        ? "bg-orange-500 border-orange-300 ring-2 ring-orange-400/50 animate-pulse" 
                        : "bg-primary border-primary-foreground ring-2 ring-primary/50 animate-pulse"
                      : isMash
                        ? "bg-orange-800 border-orange-600"
                        : "bg-muted-foreground/60 border-muted-foreground/40"
                )} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

interface MilestoneScrollRowProps {
  milestones: TimerMilestone[];
  remainingSeconds: number;
  isMash: boolean;
}

const MilestoneScrollRow = memo(function MilestoneScrollRow({ milestones, remainingSeconds, isMash }: MilestoneScrollRowProps) {
  const sortedMilestones = useMemo(() => 
    [...milestones].sort((a, b) => b.time - a.time),
    [milestones]
  );

  if (!milestones.length) return null;

  return (
    <div className="flex items-center gap-3 overflow-x-auto scrollbar-none px-2">
      {sortedMilestones.map((milestone, index, arr) => {
        const isTriggered = milestone.triggered || milestone.time >= remainingSeconds;
        const isNext = !isTriggered && 
          (index === 0 || arr.slice(0, index).every(m => m.triggered || m.time >= remainingSeconds));
        
        return (
          <div
            key={index}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded whitespace-nowrap flex-shrink-0 text-xs",
              isTriggered 
                ? "text-green-400" 
                : isNext
                  ? isMash 
                    ? "bg-orange-500/20 text-orange-200 font-medium" 
                    : "bg-primary/20 text-primary font-medium"
                  : isMash
                    ? "text-orange-400/60"
                    : "text-muted-foreground/60"
            )}
          >
            {isTriggered ? (
              <Check className="w-3 h-3 flex-shrink-0" />
            ) : (
              <Flame className={cn(
                "w-3 h-3 flex-shrink-0",
                isNext 
                  ? isMash ? "text-orange-400" : "text-primary"
                  : "opacity-50"
              )} />
            )}
            <span>{milestone.label.replace(/🔥\s*/g, '')}</span>
            <span className={cn(
              "text-[10px] opacity-60",
              isNext && "opacity-80"
            )}>
              {isTriggered ? '' : `@ ${formatTimeShort(milestone.time)}`}
            </span>
          </div>
        );
      })}
    </div>
  );
});

export const TimerFooter = memo(function TimerFooter() {
  const { isTvMode } = useTvMode();
  const timer = useExternalTimer();
  const { timerTvModeOnly, isLoading: settingsLoading } = useExternalUserSettings();
  
  // Track triggered milestones for attention notification
  const [triggeredAlert, setTriggeredAlert] = useState<{ label: string; time: number } | null>(null);
  const lastTriggeredRef = useRef<string | null>(null);

  const isMash = timer.label === 'Mäskschema';
  const isLowTime = timer.remainingSeconds < 60 && timer.remainingSeconds > 0;

  // Check if we should show based on TV mode setting
  const shouldShow = settingsLoading ? true : (timerTvModeOnly ? isTvMode : true);
  
  // Detect when a milestone just triggered (within 2 seconds of its time)
  useEffect(() => {
    if (!timer.milestones.length) return;
    
    const justTriggered = timer.milestones.find(m => {
      const diff = Math.abs(timer.remainingSeconds - m.time);
      return diff <= 2 && !m.triggered && m.label !== lastTriggeredRef.current;
    });
    
    if (justTriggered) {
      lastTriggeredRef.current = justTriggered.label;
      setTriggeredAlert({ label: justTriggered.label, time: Date.now() });
      
      // For kok (not mash): Auto-dismiss after 10 seconds
      // For mash: Keep alert visible until pausedByMilestone becomes false
      if (!isMash) {
        setTimeout(() => {
          setTriggeredAlert(null);
        }, 10000);
      }
    }
  }, [timer.remainingSeconds, timer.milestones, isMash]);

  // For mash: Dismiss alert when pausedByMilestone becomes false (acknowledged)
  useEffect(() => {
    if (isMash && triggeredAlert && !timer.pausedByMilestone && !timer.isPaused) {
      // Timer resumed, dismiss the alert
      setTriggeredAlert(null);
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
            background: 'radial-gradient(ellipse at center, rgba(234, 88, 12, 0.3) 0%, rgba(0,0,0,0.8) 100%)',
            animation: 'pulse-bg 1s ease-in-out infinite alternate',
          }}
        >
          <div 
            className="flex flex-col items-center gap-6 p-12 rounded-3xl"
            style={{
              background: 'linear-gradient(135deg, rgba(234, 88, 12, 0.95) 0%, rgba(194, 65, 12, 0.95) 100%)',
              boxShadow: '0 0 100px 20px rgba(234, 88, 12, 0.5), 0 0 200px 40px rgba(234, 88, 12, 0.3)',
              animation: 'scale-pulse 0.5s ease-out, glow 1.5s ease-in-out infinite alternate',
            }}
          >
            <div className="flex items-center gap-4">
              <AlertTriangle className="w-16 h-16 text-white animate-bounce" />
              <span className="text-white text-2xl font-bold uppercase tracking-wider">Nu!</span>
            </div>
            <div className="text-white text-4xl md:text-6xl font-bold text-center max-w-4xl">
              {triggeredAlert.label.replace(/🔥\s*/g, '')}
            </div>
            <div className="text-orange-200 text-xl">
              Utför detta steg nu
            </div>
          </div>
        </div>
      )}

      <div 
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50 border-t backdrop-blur-md",
          isMash 
            ? "bg-orange-950/95 border-orange-800/50" 
            : "bg-background/95 border-border"
        )}
        style={{
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          height: `${TIMER_FOOTER_HEIGHT}px`,
        }}
      >
      {/* Top row: Next step + Timer */}
      <div className="flex items-center justify-between gap-4 px-4 py-2 border-b border-orange-800/30">
        {/* Left: Next step */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className={cn(
            "text-xs flex-shrink-0",
            isMash ? "text-orange-400/70" : "text-muted-foreground"
          )}>
            Nästa:
          </span>
          {timer.nextMilestone ? (
            <span className={cn(
              "font-medium truncate",
              isNextMilestoneImminent 
                ? "text-yellow-300 animate-pulse" 
                : isMash 
                  ? "text-orange-200" 
                  : "text-foreground"
            )}>
              <Flame className={cn(
                "w-4 h-4 inline mr-1",
                isMash ? "text-orange-400" : "text-primary"
              )} />
              {timer.nextMilestone.label.replace(/🔥\s*/g, '')}
            </span>
          ) : (
            <span className="text-muted-foreground">Klart!</span>
          )}
        </div>

        {/* Right: Time to next (large) + Total time (small) */}
        <div className="flex items-center gap-4 flex-shrink-0">
          {timer.isPaused && (
            <div className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded text-xs",
              isMash 
                ? "bg-orange-800/50 text-orange-200" 
                : "bg-muted text-muted-foreground"
            )}>
              <Pause className="w-3 h-3" />
              PAUSAD
            </div>
          )}
          
          {/* Time to next milestone - PRIMARY */}
          {timer.timeToNextMilestone !== null && timer.timeToNextMilestone > 0 && (
            <div className="flex items-baseline gap-2">
              <span className={cn(
                "text-xs",
                isMash ? "text-orange-400/70" : "text-muted-foreground"
              )}>
                om
              </span>
              <span 
                className={cn(
                  "font-mono font-bold tabular-nums text-3xl",
                  isNextMilestoneImminent 
                    ? "text-yellow-300 animate-pulse" 
                    : isMash 
                      ? "text-orange-200" 
                      : "text-foreground"
                )}
              >
                {formatTime(timer.timeToNextMilestone)}
              </span>
            </div>
          )}
          
          {/* Separator */}
          <div className={cn(
            "h-6 w-px",
            isMash ? "bg-orange-700/50" : "bg-border"
          )} />
          
          {/* Total remaining time - secondary */}
          <div 
            className={cn(
              "font-mono tabular-nums text-lg",
              isLowTime && "animate-pulse text-red-500",
              !isLowTime && (isMash ? "text-orange-400/70" : "text-muted-foreground")
            )}
          >
            {formatTime(timer.remainingSeconds)}
          </div>
        </div>
      </div>

      {/* Middle row: Visual Timeline */}
      {timer.milestones.length > 0 && (
        <div className="px-4 py-0.5">
          <VisualTimeline 
            milestones={timer.milestones}
            totalSeconds={timer.totalSeconds}
            remainingSeconds={timer.remainingSeconds}
            isMash={isMash}
          />
        </div>
      )}

      {/* Bottom row: Scrollable milestones with arrows */}
      {timer.milestones.length > 0 && (
        <div className={cn(
          "px-2 py-1 border-t",
          isMash ? "border-orange-800/30" : "border-border/50"
        )}>
          <MilestoneScrollRow 
            milestones={timer.milestones}
            remainingSeconds={timer.remainingSeconds}
            isMash={isMash}
          />
        </div>
      )}
    </div>
    </>
  );
});
