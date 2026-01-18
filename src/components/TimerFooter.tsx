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

const Timeline = memo(function Timeline({ milestones, totalSeconds, remainingSeconds, isMash }: TimelineProps) {
  if (!milestones.length || totalSeconds <= 0) return null;

  // Sort milestones by time descending (highest time = earliest in process)
  const sortedMilestones = [...milestones].sort((a, b) => b.time - a.time);

  return (
    <div className="flex items-center gap-1 overflow-x-auto py-1 px-2 scrollbar-hide">
      {sortedMilestones.map((milestone, index) => {
        const isTriggered = milestone.triggered || milestone.time >= remainingSeconds;
        const isNext = !isTriggered && (index === 0 || sortedMilestones[index - 1].triggered || sortedMilestones[index - 1].time >= remainingSeconds);
        const isCurrent = isTriggered && (index === sortedMilestones.length - 1 || !sortedMilestones[index + 1]?.triggered);
        
        // Calculate position as percentage
        const position = totalSeconds > 0 ? ((totalSeconds - milestone.time) / totalSeconds) * 100 : 0;
        
        return (
          <div 
            key={index} 
            className={cn(
              "flex items-center gap-1 flex-shrink-0 px-2 py-1 rounded-md text-xs transition-all",
              isTriggered 
                ? "bg-muted/30 text-muted-foreground" 
                : isNext
                  ? isMash 
                    ? "bg-orange-500/30 text-orange-200 ring-1 ring-orange-500/50" 
                    : "bg-primary/30 text-primary-foreground ring-1 ring-primary/50"
                  : "bg-muted/20 text-muted-foreground/70"
            )}
          >
            {isTriggered ? (
              <Check className="w-3 h-3 text-green-500" />
            ) : (
              <span className={cn(
                "w-2 h-2 rounded-full",
                isNext 
                  ? isMash ? "bg-orange-400 animate-pulse" : "bg-primary animate-pulse"
                  : "bg-muted-foreground/50"
              )} />
            )}
            <span className="truncate max-w-[120px]" title={milestone.label}>
              {milestone.label.replace(/🔥\s*/g, '')}
            </span>
            {milestone.time > 0 && (
              <span className="text-muted-foreground/70 text-[10px]">
                @{formatTimeShort(milestone.time)}
              </span>
            )}
          </div>
        );
      })}
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
      {/* Timeline row */}
      {timer.milestones.length > 0 && (
        <div className={cn(
          "border-b px-2",
          isMash ? "border-orange-800/30" : "border-border/50"
        )}>
          <Timeline 
            milestones={timer.milestones}
            totalSeconds={timer.totalSeconds}
            remainingSeconds={timer.remainingSeconds}
            isMash={isMash}
          />
        </div>
      )}

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

        {/* Center: Next step info + Progress bar */}
        <div className="flex-1 flex flex-col gap-1 mx-4">
          {timer.nextMilestone && (
            <div className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-lg",
              isNextMilestoneImminent 
                ? "bg-yellow-500/20 border border-yellow-500/30 animate-pulse" 
                : isMash 
                  ? "bg-orange-900/50" 
                  : "bg-muted/50"
            )}>
              <Flame className={cn(
                "w-4 h-4 flex-shrink-0",
                isNextMilestoneImminent ? "text-yellow-400" : isMash ? "text-orange-400" : "text-primary"
              )} />
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className={cn(
                  "font-medium truncate",
                  isNextMilestoneImminent 
                    ? "text-yellow-200" 
                    : isMash 
                      ? "text-orange-100" 
                      : "text-foreground"
                )}>
                  {timer.nextMilestone.label.replace(/🔥\s*/g, '')}
                </span>
                {timer.timeToNextMilestone !== null && timer.timeToNextMilestone > 0 && (
                  <span className={cn(
                    "text-sm tabular-nums",
                    isNextMilestoneImminent ? "text-yellow-300" : "text-muted-foreground"
                  )}>
                    om {formatTime(timer.timeToNextMilestone)}
                  </span>
                )}
              </div>
            </div>
          )}
          
          {/* Progress bar */}
          <ProgressBar 
            progress={timer.progress}
            milestones={timer.milestones}
            totalSeconds={timer.totalSeconds}
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
