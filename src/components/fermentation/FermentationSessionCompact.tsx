import { Badge } from "@/components/ui/badge";
import { Play, Pause, ArrowDown, Thermometer, Clock, Activity } from "lucide-react";
import { FermentationProfileStep, STEP_TYPE_LABELS } from "@/types/fermentation";

interface FermentationSessionCompactProps {
  profileName: string;
  status: string;
  currentStepIndex: number;
  totalSteps: number;
  currentStep?: FermentationProfileStep;
  stepStartedAt: string;
  targetTemp: number | null;
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
  targetTemp,
  isRamping,
  rampProgress,
}: FermentationSessionCompactProps) {
  const getStepIcon = (stepType: string) => {
    switch (stepType) {
      case 'ramp': return <ArrowDown className="h-3 w-3" />;
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

  return (
    <div 
      className="relative flex items-center gap-2 p-2 rounded-md border overflow-hidden"
      style={{
        borderColor: isRamping ? 'hsl(var(--primary) / 0.3)' : 'hsl(var(--primary) / 0.2)',
      }}
    >
      {/* Gradient background for ramp progress */}
      {isRamping && rampProgress !== null && (
        <div 
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `linear-gradient(90deg, 
              hsl(var(--primary) / 0.15) 0%, 
              hsl(38 92% 50% / 0.2) ${rampProgress * 100}%, 
              hsl(var(--primary) / 0.05) ${rampProgress * 100}%, 
              hsl(var(--primary) / 0.05) 100%)`,
          }}
        />
      )}
      {!isRamping && (
        <div className="absolute inset-0 bg-primary/10 pointer-events-none" />
      )}
      
      {/* Content */}
      <div className="relative z-10 flex items-center gap-2 w-full">
        {status === 'paused' ? (
          <Pause className="w-3 h-3 text-muted-foreground shrink-0" />
        ) : isRamping ? (
          <ArrowDown className="w-3 h-3 text-amber-500 shrink-0 animate-pulse" />
        ) : (
          <Play className="w-3 h-3 text-primary shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium truncate">{profileName}</span>
            <Badge 
              variant={status === 'paused' ? 'secondary' : 'outline'} 
              className="text-[10px] px-1.5 py-0 h-4 shrink-0"
            >
              {currentStepIndex + 1}/{totalSteps}
            </Badge>
            {isRamping && rampProgress !== null && (
              <span className="text-[10px] text-amber-500 font-medium shrink-0">
                {Math.round(rampProgress * 100)}%
              </span>
            )}
          </div>
          {currentStep && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
              <span className="flex items-center gap-0.5">
                <Thermometer className="w-3 h-3 text-muted-foreground" />
                {targetTemp != null && (
                  <span className={`font-medium ${isRamping ? 'text-amber-500' : 'text-primary'}`}>
                    {targetTemp.toFixed(1)}°C
                  </span>
                )}
                {isRamping && currentStep.target_temp && 
                 targetTemp != null && Math.abs(targetTemp - currentStep.target_temp) > 0.1 && (
                  <>
                    <span className="text-muted-foreground">↘</span>
                    <span className="text-primary/70">{currentStep.target_temp}°C</span>
                  </>
                )}
              </span>
              <span className="text-muted-foreground/40">•</span>
              <span className="flex items-center gap-1 truncate">
                {getStepIcon(currentStep.step_type)}
                <span className="truncate">{getNextStepCondition(currentStep)}</span>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
