import { Badge } from "@/components/ui/badge";
import { Play, Pause, ArrowDown, Thermometer, Clock, Activity, Timer } from "lucide-react";
import { FermentationProfileStep, STEP_TYPE_LABELS } from "@/types/fermentation";

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
}: FermentationSessionCompactProps) {
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

  // Responsive icon size for TV readability
  const iconSizeClass = "h-[min(1.8vh,1.6vw)] w-[min(1.8vh,1.6vw)] min-h-3 min-w-3";
  const smallIconSizeClass = "h-[min(1.5vh,1.4vw)] w-[min(1.5vh,1.4vw)] min-h-2.5 min-w-2.5";

  const getStepIcon = (stepType: string) => {
    switch (stepType) {
      case 'ramp': return <ArrowDown className={smallIconSizeClass} />;
      case 'hold': return <Thermometer className={smallIconSizeClass} />;
      case 'wait_for_temp': return <Thermometer className={smallIconSizeClass} />;
      case 'wait_for_gravity_stable': return <Activity className={smallIconSizeClass} />;
      case 'wait_for_sg': return <Activity className={smallIconSizeClass} />;
      default: return <Clock className={smallIconSizeClass} />;
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
        if (!step.duration_hours) return 'Okänd tid';
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
        return `SG ${step.sg_comparison === 'at_or_below' ? '≤' : '≥'} ${step.target_sg}`;
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
      className="relative flex items-center gap-[min(1.5vh,1.2vw)] px-[min(1.5vh,1.4vw)] py-[min(1.2vh,1.1vw)] rounded-lg overflow-hidden backdrop-blur-md transition-all duration-300"
      style={{
        background: getBackgroundStyle(),
        border: `1px solid ${getBorderColor()}`,
        boxShadow: getBoxShadow(),
        minHeight: 'min(6vh, 5vw)',
      }}
    >
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
      
      {/* Waiting for temp pulse overlay */}
      {waitingForTemp && (
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
          <div className="p-[min(0.8vh,0.7vw)] rounded-full bg-muted/50">
            <Pause className={iconSizeClass} style={{ color: 'hsl(var(--muted-foreground))' }} />
          </div>
        ) : waitingForTemp ? (
          <div 
            className="p-[min(0.8vh,0.7vw)] rounded-full animate-pulse"
            style={{ 
              background: 'linear-gradient(135deg, hsl(200 90% 50% / 0.3) 0%, hsl(200 90% 50% / 0.15) 100%)',
              boxShadow: '0 0 12px hsl(200 90% 50% / 0.4)'
            }}
          >
            <Timer className={iconSizeClass} style={{ color: 'hsl(200 90% 60%)' }} />
          </div>
        ) : isRamping ? (
          <div 
            className="p-[min(0.8vh,0.7vw)] rounded-full animate-pulse"
            style={{ 
              background: 'linear-gradient(135deg, hsl(38 92% 50% / 0.3) 0%, hsl(38 92% 50% / 0.15) 100%)',
              boxShadow: '0 0 12px hsl(38 92% 50% / 0.4)'
            }}
          >
            <ArrowDown className={iconSizeClass} style={{ color: 'hsl(38 92% 60%)' }} />
          </div>
        ) : (
          <div 
            className="p-[min(0.8vh,0.7vw)] rounded-full"
            style={{ 
              background: 'linear-gradient(135deg, hsl(var(--primary) / 0.25) 0%, hsl(var(--primary) / 0.1) 100%)',
              boxShadow: '0 0 8px hsl(var(--primary) / 0.3)'
            }}
          >
            <Play className={iconSizeClass} style={{ color: 'hsl(var(--primary))' }} />
          </div>
        )}
      </div>
      
      {/* Content */}
      <div className="relative z-10 flex-1 min-w-0">
        <div className="flex items-center gap-[min(1vh,0.8vw)]">
          <span 
            className="font-semibold tracking-tight truncate" 
            style={{ 
              fontSize: 'max(14px, min(2vh, 1.8vw))',
              textShadow: '0 1px 2px hsl(0 0% 0% / 0.2)' 
            }}
          >
            {profileName}
          </span>
          <Badge 
            variant="outline"
            className="shrink-0 font-medium border-primary/30 bg-primary/5"
            style={{
              fontSize: 'max(10px, min(1.4vh, 1.3vw))',
              padding: 'min(0.4vh, 0.35vw) min(0.8vh, 0.7vw)',
              height: 'auto',
            }}
          >
            {currentStepIndex + 1}/{totalSteps}
          </Badge>
          {waitingForTemp && (
            <Badge 
              variant="outline"
              className="shrink-0 font-medium animate-pulse flex items-center"
              style={{
                fontSize: 'max(10px, min(1.4vh, 1.3vw))',
                padding: 'min(0.4vh, 0.35vw) min(0.8vh, 0.7vw)',
                height: 'auto',
                borderColor: 'hsl(200 90% 50% / 0.4)',
                background: 'hsl(200 90% 50% / 0.15)',
                color: 'hsl(200 90% 70%)',
              }}
            >
              <Timer className={smallIconSizeClass} style={{ marginRight: 'min(0.4vh, 0.35vw)' }} />
              Väntar
            </Badge>
          )}
          {isRamping && !waitingForTemp && rampProgress !== null && (
            <span 
              className="font-bold shrink-0 rounded"
              style={{ 
                fontSize: 'max(11px, min(1.5vh, 1.4vw))',
                padding: 'min(0.3vh, 0.25vw) min(0.6vh, 0.5vw)',
                background: 'hsl(38 92% 50% / 0.2)',
                color: 'hsl(38 92% 60%)',
              }}
            >
              {Math.round(rampProgress * 100)}%
            </span>
          )}
        </div>
        
        {currentStep && (
          <div 
            className="flex items-center gap-[min(0.8vh,0.7vw)] mt-[min(0.5vh,0.4vw)]"
            style={{ fontSize: 'max(12px, min(1.6vh, 1.5vw))' }}
          >
            {/* Temperature display - same as popup: Start → Target(delmål) → FinalTarget */}
            <span className="flex items-center gap-[min(0.5vh,0.4vw)] flex-wrap">
              <Thermometer 
                className={smallIconSizeClass}
                style={{ color: waitingForTemp ? 'hsl(200 90% 60%)' : 'hsl(var(--muted-foreground) / 0.7)' }}
              />
              
              {/* Start temp for ramp steps */}
              {isRamping && stepStartTemp != null && (
                <>
                  <span className="text-muted-foreground">{Math.round(stepStartTemp)}°C</span>
                  <span className="text-muted-foreground/50">→</span>
                </>
              )}
              
              {/* Current target temp (intermediate for ramping) */}
              {targetTemp != null && (
                <span 
                  className="font-semibold"
                  style={{ 
                    color: waitingForTemp ? 'hsl(200 90% 60%)' : isRamping ? 'hsl(38 92% 60%)' : 'hsl(var(--primary))',
                    textShadow: waitingForTemp ? '0 0 8px hsl(200 90% 50% / 0.4)' : isRamping ? '0 0 8px hsl(38 92% 50% / 0.4)' : 'none'
                  }}
                >
                  {targetTemp.toFixed(1)}°C
                </span>
              )}
              
              {/* Final target temp (if different from current target) */}
              {isRamping && currentStep.target_temp && 
               targetTemp != null && Math.abs(targetTemp - currentStep.target_temp) > 0.1 && (
                <>
                  <span className="text-muted-foreground/50">→</span>
                  <span 
                    className="font-medium"
                    style={{ color: waitingForTemp ? 'hsl(200 90% 70%)' : 'hsl(var(--primary) / 0.8)' }}
                  >
                    {currentStep.target_temp}°C
                  </span>
                </>
              )}
            </span>
            
            {/* Separator */}
            <span 
              className="rounded-full shrink-0"
              style={{ 
                width: 'min(0.5vh, 0.45vw)',
                height: 'min(0.5vh, 0.45vw)',
                minWidth: '3px',
                minHeight: '3px',
                background: 'hsl(var(--muted-foreground) / 0.3)' 
              }}
            />
            
            {/* Next step condition */}
            <span className="flex items-center gap-[min(0.4vh,0.35vw)] text-muted-foreground truncate">
              {getStepIcon(currentStep.step_type)}
              <span className="truncate font-medium">{getNextStepCondition(currentStep)}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
