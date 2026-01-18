import { memo, useMemo } from 'react';
import { ChefHat, Flame, Pause, Check } from 'lucide-react';
import { useExternalTimer, TimerMilestone } from '@/hooks/use-external-timer';
import { useTvMode } from '@/contexts/TvModeContext';
import { useExternalUserSettings } from '@/hooks/use-external-user-settings';
import { cn } from '@/lib/utils';

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

  return (
    <div className="relative w-full py-3 px-4">
      {/* Timeline track */}
      <div className="relative h-1 bg-muted/30 rounded-full">
        {/* Progress fill */}
        <div 
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-all duration-300",
            isMash ? "bg-orange-500/50" : "bg-primary/50"
          )}
          style={{ width: `${Math.min(100, progressPercent)}%` }}
        />
        
        {/* Milestone markers on track */}
        {sortedMilestones.map((milestone, index) => {
          const position = totalSeconds > 0 ? ((totalSeconds - milestone.time) / totalSeconds) * 100 : 0;
          const isTriggered = milestone.triggered || milestone.time >= remainingSeconds;
          const isNext = !isTriggered && 
            (index === 0 || sortedMilestones.slice(0, index).every(m => m.triggered || m.time >= remainingSeconds));
          
          return (
            <div
              key={index}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
              style={{ left: `${position}%` }}
            >
              {/* Marker dot */}
              <div className={cn(
                "w-3 h-3 rounded-full border-2 transition-all",
                isTriggered 
                  ? "bg-green-500 border-green-400" 
                  : isNext
                    ? isMash 
                      ? "bg-orange-500 border-orange-400 animate-pulse ring-2 ring-orange-500/30" 
                      : "bg-primary border-primary animate-pulse ring-2 ring-primary/30"
                    : "bg-muted border-muted-foreground/30"
              )} />
            </div>
          );
        })}
      </div>
      
      {/* Labels below track */}
      <div className="relative mt-2 h-10">
        {sortedMilestones.map((milestone, index) => {
          const position = totalSeconds > 0 ? ((totalSeconds - milestone.time) / totalSeconds) * 100 : 0;
          const isTriggered = milestone.triggered || milestone.time >= remainingSeconds;
          const isNext = !isTriggered && 
            (index === 0 || sortedMilestones.slice(0, index).every(m => m.triggered || m.time >= remainingSeconds));
          
          // Alternate label positions to avoid overlap
          const isEven = index % 2 === 0;
          
          return (
            <div
              key={index}
              className={cn(
                "absolute flex flex-col items-center",
                isEven ? "top-0" : "top-0"
              )}
              style={{ 
                left: `${position}%`,
                transform: 'translateX(-50%)',
                maxWidth: '100px'
              }}
            >
              {isTriggered && (
                <Check className="w-3 h-3 text-green-500 mb-0.5" />
              )}
              <span className={cn(
                "text-[10px] text-center leading-tight truncate max-w-[80px]",
                isTriggered 
                  ? "text-muted-foreground" 
                  : isNext
                    ? isMash ? "text-orange-300 font-medium" : "text-primary font-medium"
                    : "text-muted-foreground/70"
              )} title={milestone.label}>
                {milestone.label.replace(/🔥\s*/g, '').split(' – ')[0]}
              </span>
              <span className={cn(
                "text-[9px]",
                isNext 
                  ? isMash ? "text-orange-400" : "text-primary"
                  : "text-muted-foreground/50"
              )}>
                {formatTimeShort(milestone.time)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

interface ProgressBarProps {
  progress: number;
  milestones: TimerMilestone[];
  totalSeconds: number;
  isMash: boolean;
}

const ProgressBar = memo(function ProgressBar({ progress, milestones, totalSeconds, isMash }: ProgressBarProps) {
  const milestoneMarkers = useMemo(() => {
    if (totalSeconds <= 0) return [];
    return milestones.map(m => ({
      position: ((totalSeconds - m.time) / totalSeconds) * 100,
      label: m.label,
      triggered: m.triggered,
    }));
  }, [milestones, totalSeconds]);

  return (
    <div className="relative h-2 flex-1 rounded-full overflow-hidden bg-muted/30">
      {/* Progress fill */}
      <div 
        className={cn(
          "absolute inset-y-0 left-0 rounded-full transition-all duration-300",
          isMash ? "bg-orange-500" : "bg-primary"
        )}
        style={{ width: `${Math.min(100, progress * 100)}%` }}
      />
      
      {/* Milestone markers */}
      {milestoneMarkers.map((marker, index) => (
        <div
          key={index}
          className={cn(
            "absolute top-1/2 -translate-y-1/2 w-1 h-4 rounded-full transition-colors",
            marker.triggered 
              ? "bg-foreground/40" 
              : isMash 
                ? "bg-orange-300" 
                : "bg-primary-foreground/60"
          )}
          style={{ left: `${marker.position}%` }}
          title={marker.label}
        />
      ))}
    </div>
  );
});

export const TimerFooter = memo(function TimerFooter() {
  const { isTvMode } = useTvMode();
  const timer = useExternalTimer();
  const { timerTvModeOnly, isLoading: settingsLoading } = useExternalUserSettings();

  const isMash = timer.label === 'Mäskschema';
  const isLowTime = timer.remainingSeconds < 60 && timer.remainingSeconds > 0;

  // Check if we should show based on TV mode setting
  // While loading settings, show the timer (don't hide it)
  // Only apply TV mode restriction after settings are loaded
  const shouldShow = settingsLoading ? true : (timerTvModeOnly ? isTvMode : true);
  
  if (!shouldShow || !timer.isActive) {
    return null;
  }

  // Check if next milestone is imminent (less than 30 seconds)
  const isNextMilestoneImminent = timer.timeToNextMilestone !== null && timer.timeToNextMilestone <= 30 && timer.timeToNextMilestone > 0;

  return (
    <div 
      className={cn(
        "fixed bottom-0 left-0 right-0 z-50 border-t backdrop-blur-md",
        isMash 
          ? "bg-orange-950/90 border-orange-800/50" 
          : "bg-background/90 border-border"
      )}
      style={{
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {/* Main timer row */}
      <div className="flex items-center gap-4 px-4 py-3">
        {/* Left: Icon + Label */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {isMash ? (
            <ChefHat className="w-7 h-7 text-orange-400" />
          ) : (
            <Flame className="w-7 h-7 text-primary" />
          )}
          
          <span className={cn(
            "font-semibold text-base",
            isMash ? "text-orange-200" : "text-foreground"
          )}>
            {timer.label}
          </span>
        </div>

        {/* Center: Visual Timeline */}
        <div className="flex-1 mx-4">
          <VisualTimeline 
            milestones={timer.milestones}
            totalSeconds={timer.totalSeconds}
            remainingSeconds={timer.remainingSeconds}
            isMash={isMash}
          />
        </div>

        {/* Right: Paused badge + main clock */}
        <div className="flex items-center gap-3 flex-shrink-0 ml-auto">
          {timer.isPaused && (
            <div className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-md",
              isMash 
                ? "bg-orange-800/50 text-orange-200" 
                : "bg-muted text-muted-foreground"
            )}>
              <Pause className="w-3 h-3" />
              <span className="text-sm">PAUSAD</span>
            </div>
          )}

          <div className="flex flex-col items-end">
            <div 
              className={cn(
                "font-mono font-bold tabular-nums text-3xl",
                isLowTime && "animate-pulse text-red-500",
                !isLowTime && (isMash ? "text-orange-200" : "text-foreground")
              )}
            >
              {formatTime(timer.remainingSeconds)}
            </div>
            <span className="text-xs text-muted-foreground">
              Tot: {formatTime(timer.totalSeconds)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
});
