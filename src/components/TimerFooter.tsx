import { memo, useRef, useState, useEffect } from 'react';
import { Flame, Pause, AlertTriangle, Thermometer, ArrowRight } from 'lucide-react';
import { TimerMilestone } from '@/hooks/use-external-timer';
import { useExternalTimer } from '@/hooks/use-external-timer';
import { useExternalUserSettings } from '@/hooks/use-external-user-settings';
import { useTvMode } from '@/contexts/TvModeContext';
import { useTimerVisibility } from '@/contexts/TimerContext';
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
  isWhirlpool: boolean;
  isTvMode: boolean;
}

const VisualTimeline = memo(function VisualTimeline({ milestones, totalSeconds, remainingSeconds, isMash, isWhirlpool, isTvMode }: TimelineProps) {
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
          const isTriggered = milestone.triggered === true || (milestone.triggered !== false && milestone.time >= remainingSeconds);
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
                    : isWhirlpool
                      ? "text-cyan-200"
                      : "text-foreground/80"
              )}>
                {formatTimeShort(milestone.time)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Track - larger for TV visibility */}
      <div className="relative rounded-full"
        style={{
          height: '10px',
          background: 'hsl(0 0% 0% / 0.5)',
          boxShadow: 'inset 0 2px 4px hsl(0 0% 0% / 0.6), inset 0 -1px 0 hsl(0 0% 100% / 0.05)',
        }}
      >
        {/* Progress fill with glow */}
        <div 
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-300 overflow-hidden"
          style={{ 
            width: `${Math.min(100, progressPercent)}%`,
            background: isMash 
              ? 'linear-gradient(90deg, hsl(24 80% 45%), hsl(30 90% 50%), hsl(38 95% 55%))' 
              : isWhirlpool
                ? 'linear-gradient(90deg, hsl(180 60% 35%), hsl(180 70% 45%), hsl(185 80% 50%))'
                : 'linear-gradient(90deg, hsl(var(--primary) / 0.8), hsl(var(--primary)))',
            boxShadow: isMash
              ? '0 0 12px hsl(30 90% 50%), 0 0 6px hsl(30 90% 50%)'
              : isWhirlpool
                ? '0 0 12px hsl(180 70% 45%), 0 0 6px hsl(180 70% 45%)'
                : '0 0 12px hsl(var(--primary)), 0 0 6px hsl(var(--primary))',
          }}
        />
        
        {/* Shine overlay - inside track, behind markers */}
        <div 
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            background: 'linear-gradient(180deg, hsl(0 0% 100% / 0.15) 0%, transparent 50%)',
            clipPath: 'inset(0 round 9999px)',
          }}
        />
        
        {/* Milestone markers */}
        {sortedMilestones.map((milestone, index) => {
          const position = allSameTime 
            ? (index / Math.max(1, sortedMilestones.length - 1)) * 100
            : totalSeconds > 0 
              ? ((totalSeconds - milestone.time) / totalSeconds) * 100 
              : 0;
          const isTriggered = milestone.triggered === true || (milestone.triggered !== false && milestone.time >= remainingSeconds);
          const isNext = !isTriggered && 
            (index === 0 || sortedMilestones.slice(0, index).every(m => m.triggered || m.time >= remainingSeconds));
          
          return (
            <div
              key={index}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10"
              style={{ left: `${position}%` }}
            >
              <div className={cn(
                "w-4 h-4 rounded-full border-2 transition-all",
                isTriggered 
                  ? "bg-green-500 border-green-300 shadow-[0_0_8px_rgba(34,197,94,0.6)]" 
                  : isNext
                    ? isMash 
                      ? cn("bg-orange-400 border-orange-200 ring-2 ring-orange-400/60 shadow-[0_0_12px_rgba(251,146,60,0.7)]", !isTvMode && "animate-pulse")
                      : isWhirlpool
                        ? cn("bg-cyan-400 border-cyan-200 ring-2 ring-cyan-400/60 shadow-[0_0_12px_rgba(34,211,238,0.7)]", !isTvMode && "animate-pulse")
                        : cn("bg-primary border-primary-foreground ring-2 ring-primary/60 shadow-[0_0_12px_rgba(var(--primary),0.7)]", !isTvMode && "animate-pulse")
                    : isMash
                      ? "bg-orange-800 border-orange-600"
                      : isWhirlpool
                        ? "bg-cyan-800 border-cyan-600"
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
  const timer = useExternalTimer();
  const { timerTvModeOnly } = useExternalUserSettings();
  const { isTvMode } = useTvMode();
  const { setTimerVisible } = useTimerVisibility();
  
  // Track triggered milestones for attention notification
  const [triggeredAlert, setTriggeredAlert] = useState<{ label: string; time: number } | null>(null);
  const lastTriggeredRef = useRef<Set<string>>(new Set());
  const prevLabelRef = useRef<string>(timer.label);

  const isMash = timer.label === 'Mäskschema';
  const isWhirlpool = timer.label?.toLowerCase().includes('whirlpool') || timer.label?.toLowerCase().includes('hopstand');
  const isLowTime = timer.remainingSeconds < 60 && timer.remainingSeconds > 0;
  
  // Find the current step: triggered but not yet acknowledged = active
  // If none active, fall back to most recently completed milestone
  const currentMilestone = timer.milestones
    .filter(m => m.triggered === true || (m.triggered !== false && m.time >= timer.remainingSeconds))
    .sort((a, b) => a.time - b.time)[0] || null;

  // Check if we should show based on TV mode setting
  const shouldShow = timerTvModeOnly ? isTvMode : true;

  // Reset triggered milestones when phase changes (e.g. Mäsk → Kok → Whirlpool)
  useEffect(() => {
    if (prevLabelRef.current !== timer.label) {
      lastTriggeredRef.current = new Set();
      setTriggeredAlert(null);
      prevLabelRef.current = timer.label;
    }
  }, [timer.label]);

  // Detect when a milestone becomes triggered+unacknowledged (needs attention)
  useEffect(() => {
    if (!timer.milestones.length || !timer.isActive) return;
    
    // Find milestones that are triggered but not acknowledged and not already shown
    const justTriggered = timer.milestones.find(m => {
      return m.triggered && !m.acknowledged && !lastTriggeredRef.current.has(m.label);
    });
    
    if (justTriggered) {
      lastTriggeredRef.current.add(justTriggered.label);
      setTriggeredAlert({ label: justTriggered.label, time: Date.now() });
    }
  }, [timer.milestones, timer.isActive]);

  // Dismiss alert when acknowledged externally via synced data
  // Mash: pausedByMilestone becomes false when acknowledged
  // Kok: auto-dismiss after 120+ seconds past the milestone, or when acknowledged
  useEffect(() => {
    if (!triggeredAlert) return;
    
    if (isMash && !timer.pausedByMilestone && !timer.isPaused) {
      const timeSinceTriggered = Date.now() - triggeredAlert.time;
      if (timeSinceTriggered > 500) {
        setTriggeredAlert(null);
      }
    } else if (!isMash) {
      // Find the milestone that triggered this alert
      const alertMilestone = timer.milestones.find(m => m.label === triggeredAlert.label);
      if (alertMilestone) {
        // Dismiss when acknowledged in brew app (primary)
        if (alertMilestone.acknowledged) {
          setTriggeredAlert(null);
        }
        // Fallback: dismiss after 120+ seconds past milestone time
        const secondsPastMilestone = alertMilestone.time - timer.remainingSeconds;
        if (secondsPastMilestone >= 120) {
          setTriggeredAlert(null);
        }
      }
    }
  }, [isMash, triggeredAlert, timer.pausedByMilestone, timer.isPaused, timer.milestones, timer.remainingSeconds]);

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
              Kvittera i bryggappen
            </div>
          </div>
        </div>
      )}

      {/* Main footer - 3 column grid layout for TV */}
      <div 
        className="absolute bottom-0 left-0 right-0 z-20 backdrop-blur-xl"
        style={{
          height: `${TIMER_FOOTER_HEIGHT}px`,
          background: isMash
            ? 'linear-gradient(145deg, hsl(24 80% 15% / 0.7) 0%, hsl(222 20% 12% / 0.85) 100%)'
            : isWhirlpool
              ? 'linear-gradient(145deg, hsl(180 60% 15% / 0.7) 0%, hsl(222 20% 12% / 0.85) 100%)'
              : 'linear-gradient(145deg, hsl(var(--primary) / 0.15) 0%, hsl(222 20% 12% / 0.85) 100%)',
          borderTop: isMash
            ? '1px solid hsl(24 80% 40% / 0.15)'
            : isWhirlpool
              ? '1px solid hsl(180 60% 40% / 0.15)'
              : '1px solid hsl(0 0% 100% / 0.08)',
          boxShadow: '0 -8px 24px hsl(222 30% 3% / 0.5), inset 0 1px 0 hsl(0 0% 100% / 0.08)',
        }}
      >
        {/* Top light reflection */}
        <div 
          className="absolute inset-x-0 top-0 h-[1px] pointer-events-none z-10"
          style={{
            background: 'linear-gradient(90deg, transparent 25%, hsl(0 0% 100% / 0.04) 45%, hsl(0 0% 100% / 0.06) 55%, hsl(0 0% 100% / 0.04) 65%, transparent 80%)'
          }}
        />
        {/* 3-column grid: Current/Next Steps | Timeline | Time (auto-width) */}
        <div className="grid grid-cols-[350px_1fr_auto] h-full">
          
          {/* LEFT COLUMN: Current Step + Next Step */}
          <div className={cn(
            "flex flex-col justify-center px-4 border-r gap-1",
            "border-white/5"
          )}>
            {/* Current Step - show last triggered milestone or timer label */}
            <div className="flex items-center gap-2">
              <span className={cn(
                "text-sm uppercase tracking-wide flex-shrink-0 font-medium",
                isMash ? "text-green-400/90" : "text-green-500/90"
              )}>
                Nu:
              </span>
              <span className={cn(
                "text-base font-semibold truncate",
                isMash ? "text-green-300" : "text-green-400"
              )}>
                {currentMilestone 
                  ? currentMilestone.label.replace(/🔥\s*/g, '') 
                  : timer.label || 'Pågår'}
              </span>
              {/* Temperature target for whirlpool/pauseForTemperature milestones */}
              {currentMilestone?.pauseForTemperature && currentMilestone.targetTemperature && (
                <div className={cn(
                  "flex items-center gap-1 flex-shrink-0 px-2 py-0.5 rounded text-xs font-bold",
                  isWhirlpool 
                    ? "bg-cyan-500/20 text-cyan-300" 
                    : "bg-orange-500/20 text-orange-300"
                )}>
                  <Thermometer className="w-3.5 h-3.5" />
                  <span>Kyl till {currentMilestone.targetTemperature}°C</span>
                </div>
              )}
              {currentMilestone?.whirlpoolTime && (
                <div className={cn(
                  "flex items-center gap-1 flex-shrink-0 px-2 py-0.5 rounded text-xs font-bold",
                  "bg-cyan-500/20 text-cyan-300"
                )}>
                  <span>{currentMilestone.whirlpoolTime} min whirlpool</span>
                </div>
              )}
            </div>
            
            {/* Next Step */}
            <div className="flex items-center gap-2">
              <span className={cn(
                "text-sm uppercase tracking-wide flex-shrink-0 font-medium",
                isMash ? "text-orange-400/90" : isWhirlpool ? "text-cyan-400/90" : "text-muted-foreground"
              )}>
                Nästa:
              </span>
              {timer.nextMilestone ? (
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <Flame className={cn(
                    "w-4 h-4 flex-shrink-0",
                    isNextMilestoneImminent 
                      ? "text-yellow-400 animate-pulse" 
                      : isMash 
                        ? "text-orange-400" 
                        : isWhirlpool
                          ? "text-cyan-400"
                          : "text-primary"
                  )} />
                  <span className={cn(
                    "text-base font-semibold truncate",
                    isNextMilestoneImminent 
                      ? "text-yellow-300" 
                      : isMash 
                        ? "text-orange-100" 
                        : isWhirlpool
                          ? "text-cyan-100"
                          : "text-foreground"
                  )}>
                    {timer.nextMilestone.label.replace(/🔥\s*/g, '')}
                  </span>
                </div>
              ) : timer.nextConfig ? (
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <ArrowRight className={cn(
                    "w-4 h-4 flex-shrink-0",
                    isMash ? "text-orange-400" : isWhirlpool ? "text-cyan-400" : "text-primary"
                  )} />
                  <span className={cn(
                    "text-base font-semibold truncate",
                    isMash ? "text-orange-100" : isWhirlpool ? "text-cyan-100" : "text-foreground"
                  )}>
                    {timer.nextConfig.label} ({timer.nextConfig.minutes} min)
                  </span>
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
                isWhirlpool={isWhirlpool}
                isTvMode={isTvMode}
              />
            ) : (
              <div className="relative w-full rounded-full overflow-hidden"
                style={{
                  height: '10px',
                  background: 'hsl(0 0% 0% / 0.5)',
                  boxShadow: 'inset 0 2px 4px hsl(0 0% 0% / 0.6), inset 0 -1px 0 hsl(0 0% 100% / 0.05)',
                }}
              >
                <div 
                  className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
                  style={{ 
                    width: `${timer.totalSeconds > 0 ? Math.min(100, ((timer.totalSeconds - timer.remainingSeconds) / timer.totalSeconds) * 100) : 0}%`,
                    background: isMash 
                      ? 'linear-gradient(90deg, hsl(24 80% 45%), hsl(30 90% 50%), hsl(38 95% 55%))' 
                      : isWhirlpool
                        ? 'linear-gradient(90deg, hsl(180 60% 35%), hsl(180 70% 45%), hsl(185 80% 50%))'
                        : 'linear-gradient(90deg, hsl(var(--primary) / 0.8), hsl(var(--primary)))',
                    boxShadow: isMash
                      ? '0 0 12px hsl(30 90% 50%), 0 0 6px hsl(30 90% 50%)'
                      : isWhirlpool
                        ? '0 0 12px hsl(180 70% 45%), 0 0 6px hsl(180 70% 45%)'
                        : '0 0 12px hsl(var(--primary)), 0 0 6px hsl(var(--primary))',
                  }}
                />
                <div 
                  className="absolute inset-0 rounded-full pointer-events-none"
                  style={{
                    background: 'linear-gradient(180deg, hsl(0 0% 100% / 0.15) 0%, transparent 50%)',
                  }}
                />
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: Time Display */}
          <div className={cn(
            "flex flex-col justify-center items-end px-4 border-l",
            "border-white/5"
          )}>
            {timer.isPaused && (
              <div className={cn(
                "flex items-center gap-1.5 rounded font-bold uppercase tracking-wider",
                timer.pausedByMilestone
                  ? "px-4 py-1.5 text-sm animate-pulse"
                  : "px-2 py-0.5 text-xs mb-1"
              )}
              style={timer.pausedByMilestone ? {
                background: isMash 
                  ? 'linear-gradient(135deg, hsl(24 95% 50% / 0.8) 0%, hsl(30 100% 40% / 0.7) 100%)'
                  : isWhirlpool
                    ? 'linear-gradient(135deg, hsl(180 80% 45% / 0.8) 0%, hsl(185 90% 35% / 0.7) 100%)'
                    : 'linear-gradient(135deg, hsl(45 100% 50% / 0.8) 0%, hsl(35 100% 45% / 0.7) 100%)',
                color: isMash ? 'hsl(24 100% 95%)' : isWhirlpool ? 'hsl(180 100% 95%)' : 'hsl(45 100% 10%)',
                boxShadow: isMash 
                  ? '0 0 16px hsl(24 95% 50% / 0.5), 0 0 32px hsl(24 95% 50% / 0.2)'
                  : isWhirlpool
                    ? '0 0 16px hsl(180 80% 45% / 0.5), 0 0 32px hsl(180 80% 45% / 0.2)'
                    : '0 0 16px hsl(45 100% 50% / 0.5), 0 0 32px hsl(45 100% 50% / 0.2)',
              } : {
                background: isMash ? 'hsl(24 60% 20% / 0.6)' : isWhirlpool ? 'hsl(180 40% 20% / 0.6)' : 'hsl(var(--muted))',
                color: isMash ? 'hsl(24 80% 75%)' : isWhirlpool ? 'hsl(180 60% 75%)' : 'hsl(var(--muted-foreground))',
              }}
              >
                {timer.pausedByMilestone ? (
                  <>
                    <AlertTriangle className="w-4 h-4" />
                    Väntar på åtgärd
                  </>
                ) : (
                  <>
                    <Pause className="w-3 h-3" />
                    PAUSAD
                  </>
                )}
              </div>
            )}
            
            {/* Time to next milestone - PRIMARY (large for TV) */}
            {timer.timeToNextMilestone !== null && timer.timeToNextMilestone > 0 && (
              <div className="flex items-baseline gap-2">
                <span className={cn(
                  "text-sm",
                  isMash ? "text-orange-400/80" : isWhirlpool ? "text-cyan-400/80" : "text-muted-foreground"
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
                        : isWhirlpool
                          ? "text-cyan-100"
                          : "text-foreground"
                  )}
                >
                  {formatTime(timer.timeToNextMilestone)}
                </span>
              </div>
            )}
            
            {/* Total remaining time - secondary */}
            <div 
              className={cn(
                "font-mono tabular-nums text-base",
                isLowTime && "animate-pulse text-red-400",
                !isLowTime && (isMash ? "text-orange-400/70" : isWhirlpool ? "text-cyan-400/70" : "text-muted-foreground")
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
