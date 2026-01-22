import { Badge } from "@/components/ui/badge";
import { Play, Pause, ArrowDown, ArrowUp, Thermometer, Clock, Activity, Timer } from "lucide-react";
import { FermentationProfileStep, STEP_TYPE_LABELS } from "@/types/fermentation";
import { useTvMode } from "@/contexts/TvModeContext";

interface FermentationSessionCompactProps {
  profileName: string;
  status: string;
  currentStepIndex: number;
  totalSteps: number;
  currentStep?: FermentationProfileStep;
  stepStartedAt: string;
  stepStartTemp?: number | null;
  targetTemp: number | null;
  currentTemp?: number | null;
  isRamping: boolean;
  rampProgress: number | null;
  currentSg?: number | null;
  targetSg?: number | null;
  sgComparison?: string | null;
  originalGravity?: number | null;
}

export function FermentationSessionCompact({
  profileName,
  status,
  currentStepIndex,
  totalSteps,
  currentStep,
  stepStartedAt,
  stepStartTemp,
  targetTemp,
  currentTemp,
  isRamping,
  rampProgress,
  currentSg,
  targetSg,
  sgComparison,
  originalGravity,
}: FermentationSessionCompactProps) {
  const { isTvMode } = useTvMode();

  // Calculate SG progress (0-1) based on how far we've fermented toward the target
  const sgProgress = (() => {
    if (targetSg == null || currentSg == null || originalGravity == null) return null;
    if (originalGravity <= targetSg) return null; // Invalid: OG should be higher than target
    
    // Progress = how much we've dropped from OG toward target
    const totalDrop = originalGravity - targetSg;
    const currentDrop = originalGravity - currentSg;
    const progress = Math.max(0, Math.min(1, currentDrop / totalDrop));
    return progress;
  })();
  // Check if ramp step time is complete but temp not reached
  const isRampTimeComplete = () => {
    if (!currentStep || currentStep.step_type !== 'ramp' || !currentStep.duration_hours) {
      return false;
    }
    const stepStarted = new Date(stepStartedAt);
    const elapsedHours = (Date.now() - stepStarted.getTime()) / (1000 * 60 * 60);
    return elapsedHours >= currentStep.duration_hours;
  };

  const isTargetTempReached = () => {
    if (!currentStep || currentStep.target_temp == null || currentTemp == null) {
      return false;
    }
    return Math.abs(currentTemp - currentStep.target_temp) <= 0.5;
  };

  const waitingForTemp = currentStep?.step_type === 'ramp' && isRampTimeComplete() && !isTargetTempReached();
  const tempDifference = currentStep?.target_temp != null && currentTemp != null 
    ? Math.abs(currentTemp - currentStep.target_temp).toFixed(1) 
    : null;

  // Determine if ramping up or down based on start temp vs target temp
  const isRampingUp = currentStep?.step_type === 'ramp' && 
    currentStep.target_temp != null && 
    stepStartTemp != null && 
    currentStep.target_temp > stepStartTemp;

  const getStepIcon = (stepType: string) => {
    switch (stepType) {
      case 'ramp': return isRampingUp ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
      case 'hold': return <Thermometer className="h-3 w-3" />;
      case 'wait_for_temp': return <Thermometer className="h-3 w-3" />;
      case 'wait_for_gravity_stable': return <Activity className="h-3 w-3" />;
      case 'wait_for_sg': return <Activity className="h-3 w-3" />;
      default: return <Clock className="h-3 w-3" />;
    }
  };

  const formatRemainingTime = (remainingHours: number) => {
    const hours = Math.floor(remainingHours);
    const minutes = Math.round((remainingHours - hours) * 60);
    if (hours === 0) {
      return `${minutes}min kvar`;
    }
    return `${hours}h ${minutes}min kvar`;
  };

  const getNextStepCondition = (step: FermentationProfileStep) => {
    // If waiting for temp on ramp step, show that status
    if (waitingForTemp && tempDifference) {
      return `Väntar på temp (${tempDifference}° kvar)`;
    }

    switch (step.step_type) {
      case 'hold': {
        // Check if this is a SG-conditioned hold (no duration but has target_sg from step OR session props)
        const stepTargetSg = step.target_sg ?? targetSg;
        const stepSgComparison = step.sg_comparison ?? sgComparison;
        
        if (stepTargetSg != null && !step.duration_hours) {
          if (currentSg != null) {
            // Show progress text since SG indicator already shows the values
            const progress = sgProgress != null ? ` (${Math.round(sgProgress * 100)}%)` : '';
            return `Väntar på mål-SG${progress}`;
          }
          return `Mål-SG ${stepSgComparison === 'at_or_below' ? '≤' : '≥'} ${stepTargetSg.toFixed(3)}`;
        }
        if (!step.duration_hours) return 'Tidsstyrt steg saknar tid';
        const stepStarted = new Date(stepStartedAt);
        const elapsed = (Date.now() - stepStarted.getTime()) / (1000 * 60 * 60);
        const remaining = Math.max(0, step.duration_hours - elapsed);
        return formatRemainingTime(remaining);
      }
      case 'ramp': {
        if (step.ramp_type === 'immediate') {
          return 'Direkt ändring';
        }
        if (!step.duration_hours) return 'Okänd tid';
        const stepStarted = new Date(stepStartedAt);
        const elapsed = (Date.now() - stepStarted.getTime()) / (1000 * 60 * 60);
        const remaining = Math.max(0, step.duration_hours - elapsed);
        return formatRemainingTime(remaining);
      }
      case 'wait_for_temp':
        return `Nå ${step.target_temp}°C`;
      case 'wait_for_gravity_stable':
        return `Stabil i ${step.gravity_stable_days}d`;
      case 'wait_for_sg':
        return `SG ${step.sg_comparison === 'at_or_below' ? '≤' : '≥'} ${step.target_sg?.toFixed(3) ?? ''}`;
      default:
        return '';
    }
  };

  // Determine the visual state
  const visualState = waitingForTemp ? 'waiting' : isRamping ? 'ramping' : 'normal';

  const getBackgroundStyle = () => {
    if (waitingForTemp) {
      return 'linear-gradient(135deg, hsl(200 90% 50% / 0.15) 0%, hsl(200 90% 50% / 0.08) 100%)';
    }
    if (isRamping) {
      return 'linear-gradient(135deg, hsl(38 92% 50% / 0.12) 0%, hsl(var(--primary) / 0.08) 100%)';
    }
    return 'linear-gradient(135deg, hsl(var(--primary) / 0.1) 0%, hsl(var(--primary) / 0.05) 100%)';
  };

  const getBorderColor = () => {
    if (waitingForTemp) return 'hsl(200 90% 50% / 0.3)';
    if (isRamping) return 'hsl(38 92% 50% / 0.25)';
    return 'hsl(var(--primary) / 0.2)';
  };

  const getBoxShadow = () => {
    if (waitingForTemp) {
      return '0 4px 20px hsl(200 90% 50% / 0.2), inset 0 1px 0 hsl(0 0% 100% / 0.1)';
    }
    if (isRamping) {
      return '0 4px 20px hsl(38 92% 50% / 0.15), inset 0 1px 0 hsl(0 0% 100% / 0.1)';
    }
    return '0 4px 16px hsl(var(--primary) / 0.1), inset 0 1px 0 hsl(0 0% 100% / 0.08)';
  };

  return (
    <div 
      className="relative flex items-center gap-2 px-3 py-2 rounded-lg overflow-hidden backdrop-blur-md transition-all duration-300"
      style={{
        background: getBackgroundStyle(),
        border: `1px solid ${getBorderColor()}`,
        boxShadow: getBoxShadow(),
      }}
    >
      {/* SG Progress background overlay - green gradient showing fermentation progress */}
      {sgProgress !== null && sgProgress > 0 && (
        <div 
          className="absolute inset-0 pointer-events-none transition-all duration-1000"
          style={{
            background: `linear-gradient(90deg, 
              hsl(142 70% 45% / 0.25) 0%, 
              hsl(142 70% 50% / 0.15) ${sgProgress * 100}%, 
              transparent ${sgProgress * 100}%)`,
          }}
        />
      )}
      
      {/* Animated ramp progress overlay */}
      {isRamping && !waitingForTemp && rampProgress !== null && (
        <div 
          className="absolute inset-0 pointer-events-none transition-all duration-500"
          style={{
            background: `linear-gradient(90deg, 
              hsl(38 92% 50% / 0.2) 0%, 
              hsl(38 92% 50% / 0.08) ${rampProgress * 100}%, 
              transparent ${rampProgress * 100}%)`,
          }}
        />
      )}
      
      {/* Waiting for temp pulse overlay - disabled in TV mode */}
      {waitingForTemp && !isTvMode && (
        <div 
          className="absolute inset-0 pointer-events-none animate-pulse"
          style={{
            background: 'linear-gradient(90deg, hsl(200 90% 50% / 0.1) 0%, hsl(200 90% 50% / 0.05) 100%)',
          }}
        />
      )}
      
      {/* Subtle shimmer effect on top edge */}
      <div 
        className="absolute inset-x-0 top-0 h-[1px] pointer-events-none"
        style={{
          background: 'linear-gradient(90deg, transparent 10%, hsl(0 0% 100% / 0.15) 50%, transparent 90%)'
        }}
      />
      
      {/* Status icon with glow */}
      <div className="relative z-10 shrink-0">
        {status === 'paused' ? (
          <div className="p-1.5 rounded-full bg-muted/50">
            <Pause className="h-4 w-4 text-muted-foreground" />
          </div>
        ) : waitingForTemp ? (
          <div 
            className={isTvMode ? 'p-1.5 rounded-full' : 'p-1.5 rounded-full animate-pulse'}
            style={{ 
              background: 'linear-gradient(135deg, hsl(200 90% 50% / 0.3) 0%, hsl(200 90% 50% / 0.15) 100%)',
              boxShadow: '0 0 12px hsl(200 90% 50% / 0.4)'
            }}
          >
            <Timer className="h-4 w-4" style={{ color: 'hsl(200 90% 60%)' }} />
          </div>
        ) : isRamping ? (
          <div 
            className={isTvMode ? 'p-1.5 rounded-full' : 'p-1.5 rounded-full animate-pulse'}
            style={{ 
              background: 'linear-gradient(135deg, hsl(38 92% 50% / 0.3) 0%, hsl(38 92% 50% / 0.15) 100%)',
              boxShadow: '0 0 12px hsl(38 92% 50% / 0.4)'
            }}
          >
            {isRampingUp ? (
              <ArrowUp className="h-4 w-4" style={{ color: 'hsl(38 92% 60%)' }} />
            ) : (
              <ArrowDown className="h-4 w-4" style={{ color: 'hsl(38 92% 60%)' }} />
            )}
          </div>
        ) : (
          <div className="relative flex items-center justify-center w-7 h-7">
            {/* Pulsing ring - disabled in TV mode */}
            {!isTvMode && (
              <div 
                className="absolute inset-0 rounded-full animate-ping"
                style={{ 
                  background: 'hsl(142 70% 45% / 0.3)',
                  animationDuration: '2s',
                }}
              />
            )}
            {/* Solid indicator */}
            <div 
              className="relative w-3 h-3 rounded-full"
              style={{ 
                background: 'linear-gradient(135deg, hsl(142 70% 55%) 0%, hsl(142 70% 40%) 100%)',
                boxShadow: '0 0 8px hsl(142 70% 50% / 0.6)'
              }}
            />
          </div>
        )}
      </div>
      
      {/* Content */}
      <div className="relative z-10 flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold tracking-tight truncate">
            {profileName}
          </span>
          <Badge 
            variant="outline"
            className="shrink-0 text-xs font-medium border-primary/30 bg-primary/5 px-1.5 py-0"
          >
            {currentStepIndex + 1}/{totalSteps}
          </Badge>
          {waitingForTemp && (
            <Badge 
              variant="outline"
              className={`shrink-0 text-xs font-medium flex items-center gap-0.5 px-1.5 py-0 ${isTvMode ? '' : 'animate-pulse'}`}
              style={{
                borderColor: 'hsl(200 90% 50% / 0.4)',
                background: 'hsl(200 90% 50% / 0.15)',
                color: 'hsl(200 90% 70%)',
              }}
            >
              <Timer className="h-3 w-3" />
              Väntar
            </Badge>
          )}
          {isRamping && !waitingForTemp && rampProgress !== null && (
            <span 
              className="text-xs font-bold shrink-0 rounded px-1"
              style={{ 
                background: 'hsl(38 92% 50% / 0.2)',
                color: 'hsl(38 92% 60%)',
              }}
            >
              {Math.round(rampProgress * 100)}%
            </span>
          )}
        </div>
        
        {currentStep && (
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-0.5 text-xs">
            {/* Temperature display */}
            <span className="flex items-center gap-1 shrink-0">
              <Thermometer 
                className="h-3 w-3 shrink-0"
                style={{ color: waitingForTemp ? 'hsl(200 90% 60%)' : 'hsl(var(--muted-foreground) / 0.7)' }}
              />
              
              {/* For ramp steps: show Start → Aktuellt → Slutmål */}
              {isRamping && stepStartTemp != null && currentStep?.target_temp != null ? (
                <>
                  {/* Start temp */}
                  <span className="text-muted-foreground/70">
                    {stepStartTemp.toFixed(0)}°
                  </span>
                  <span className="text-muted-foreground/40">→</span>
                  
                  {/* Current target temp */}
                  {targetTemp != null && (
                    <span 
                      className="font-semibold"
                      style={{ 
                        color: waitingForTemp ? 'hsl(200 90% 60%)' : 'hsl(38 92% 60%)',
                      }}
                    >
                      {targetTemp.toFixed(1)}°C
                    </span>
                  )}
                  
                  <span className="text-muted-foreground/40">→</span>
                  
                  {/* Final target temp */}
                  <span className="font-medium text-muted-foreground">
                    {currentStep.target_temp.toFixed(0)}°
                  </span>
                </>
              ) : (
                /* Non-ramp steps: just show target temp */
                targetTemp != null && (
                  <span 
                    className="font-semibold"
                    style={{ 
                      color: waitingForTemp ? 'hsl(200 90% 60%)' : 'hsl(var(--primary))',
                    }}
                  >
                    {targetTemp.toFixed(1)}°C
                  </span>
                )
              )}
            </span>
            
            {/* SG target indicator - show when step has SG condition */}
            {targetSg != null && (
              <>
                <span className="w-1 h-1 rounded-full bg-muted-foreground/30 shrink-0" />
                <span className="flex items-center gap-1 shrink-0">
                  <Activity 
                    className="h-3 w-3 shrink-0" 
                    style={{ color: 'hsl(142 70% 50%)' }}
                  />
                  <span className="text-muted-foreground font-medium whitespace-nowrap">
                    Mål: {sgComparison === 'at_or_below' ? '≤' : ''}{targetSg.toFixed(3)}
                  </span>
                </span>
              </>
            )}
            
            {/* Separator */}
            <span className="w-1 h-1 rounded-full bg-muted-foreground/30 shrink-0" />
            
            {/* Next step condition */}
            <span className="flex items-center gap-1 text-muted-foreground">
              {getStepIcon(currentStep.step_type)}
              <span className="font-medium">{getNextStepCondition(currentStep)}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
