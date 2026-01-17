import { Thermometer, Clock, Activity, ArrowDown, ChevronRight, Loader2, AlertCircle } from "lucide-react";
import { FermentationProfileStep, STEP_TYPE_LABELS } from "@/types/fermentation";

interface FermentationStepDisplayProps {
  currentStep: FermentationProfileStep;
  steps: FermentationProfileStep[];
  currentStepIndex: number;
  stepStartedAt: string;
  stepStartTemp?: number | null;
  targetTemp: number | null;
  currentTemp: number | null;
  isRamping: boolean;
  rampProgress: number | null;
  stepProgress: number;
  isProcessing?: boolean;
}

export function FermentationStepDisplay({
  currentStep,
  steps,
  currentStepIndex,
  stepStartedAt,
  stepStartTemp,
  targetTemp,
  currentTemp,
  isRamping,
  rampProgress,
  stepProgress,
  isProcessing = false,
}: FermentationStepDisplayProps) {
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

  const getStepDescription = (step: FermentationProfileStep) => {
    switch (step.step_type) {
      case 'hold':
        return `${step.target_temp}°C i ${step.duration_hours}h`;
      case 'ramp':
        return `${step.ramp_type === 'immediate' ? '→' : '↘'} ${step.target_temp}°C`;
      case 'wait_for_temp':
        return `Vänta tills ${step.target_temp}°C`;
      case 'wait_for_gravity_stable':
        return `Stabil SG ${step.gravity_stable_days}d`;
      case 'wait_for_sg':
        return `SG ${step.sg_comparison === 'at_or_below' ? '≤' : '≥'} ${step.target_sg}`;
      default:
        return '';
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

  // Check if ramp time is complete
  const isRampTimeComplete = () => {
    if (currentStep.step_type !== 'ramp' || currentStep.ramp_type !== 'linear') return false;
    if (!currentStep.duration_hours) return false;
    const stepStarted = new Date(stepStartedAt);
    const elapsed = (Date.now() - stepStarted.getTime()) / (1000 * 60 * 60);
    return elapsed >= currentStep.duration_hours;
  };

  // Check if target temp is reached (within 0.5°C tolerance)
  const isTargetTempReached = () => {
    if (currentStep.target_temp === null || currentTemp === null) return false;
    return Math.abs(currentTemp - currentStep.target_temp) <= 0.5;
  };

  const rampTimeComplete = isRampTimeComplete();
  const tempReached = isTargetTempReached();
  const waitingForTemp = rampTimeComplete && !tempReached;

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
        
        // If time is complete but temp not reached
        if (waitingForTemp && step.target_temp !== null && currentTemp !== null) {
          const tempDiff = Math.abs(currentTemp - step.target_temp);
          return `Väntar på temp (${tempDiff.toFixed(1)}° kvar)`;
        }
        
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

  const nextStep = steps[currentStepIndex + 1];

  return (
    <div className="space-y-2">
      {/* Current Step Card */}
      <div 
        className="bg-muted/50 rounded-md p-2 space-y-2"
        style={{
          background: waitingForTemp
            ? `linear-gradient(90deg, 
                hsl(var(--muted) / 0.7) 0%, 
                hsl(200 80% 50% / 0.2) 100%)`
            : isRamping && rampProgress !== null
            ? `linear-gradient(90deg, 
                hsl(var(--muted) / 0.7) 0%, 
                hsl(38 92% 50% / 0.15) ${rampProgress * 100}%, 
                hsl(var(--muted) / 0.5) ${rampProgress * 100}%, 
                hsl(var(--muted) / 0.5) 100%)`
            : undefined
        }}
      >
        <div className="flex items-center gap-2">
          <div className="p-1 rounded bg-background">
            {getStepIcon(currentStep.step_type)}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <div className="text-xs font-medium">{STEP_TYPE_LABELS[currentStep.step_type]}</div>
              {waitingForTemp ? (
                <span className="text-[10px] text-blue-400 font-medium flex items-center gap-1">
                  <Thermometer className="w-2.5 h-2.5" />
                  Väntar på temp
                </span>
              ) : isRamping && rampProgress !== null && (
                <span className="text-[10px] text-amber-500 font-medium">
                  {Math.round(rampProgress * 100)}%
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">{getStepDescription(currentStep)}</div>
          </div>
        </div>
        
        {/* Temperature display */}
        {targetTemp != null && (
          <div className="flex items-center gap-2 py-1.5 px-2 bg-background/50 rounded text-xs">
            <Thermometer className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {/* Show start temp for ramp steps */}
              {isRamping && stepStartTemp != null && (
                <>
                  <span className="text-muted-foreground">{Math.round(stepStartTemp)}°C</span>
                  <span className="text-muted-foreground">→</span>
                </>
              )}
              
              <span className={`font-medium ${waitingForTemp ? 'text-blue-400' : isRamping ? 'text-amber-500' : 'text-primary'}`}>
                {targetTemp.toFixed(1)}°C
              </span>
              
              {isRamping && currentStep.target_temp && Math.abs(targetTemp - currentStep.target_temp) > 0.1 && (
                <>
                  <span className="text-muted-foreground">→</span>
                  <span className="text-primary/70">{currentStep.target_temp}°C</span>
                </>
              )}
              
              {currentTemp != null && (
                <>
                  <span className="text-muted-foreground/40 mx-1">|</span>
                  <span className="text-muted-foreground">
                    Aktuell: <span className={`font-medium ${waitingForTemp ? 'text-blue-400' : 'text-foreground'}`}>{currentTemp.toFixed(1)}°C</span>
                  </span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Waiting for temperature notice */}
        {waitingForTemp && currentStep.target_temp !== null && currentTemp !== null && (
          <div className="flex items-center gap-2 py-1.5 px-2 bg-blue-500/10 border border-blue-500/20 rounded text-xs text-blue-400">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>
              Tid klar, väntar på att temperaturen når {currentStep.target_temp}°C 
              ({Math.abs(currentTemp - currentStep.target_temp).toFixed(1)}° kvar)
            </span>
          </div>
        )}
        
        {/* Step Progress - time remaining only, no bar */}
        {(currentStep.step_type === 'hold' || 
          (currentStep.step_type === 'ramp' && currentStep.ramp_type === 'linear')) && (
          <div className="flex justify-between text-[10px] px-1">
            <span className="text-muted-foreground">Stegprogress</span>
            <span className={`font-medium ${waitingForTemp ? 'text-blue-400' : ''}`}>
              {getNextStepCondition(currentStep)}
            </span>
          </div>
        )}
      </div>

      {/* Next Step Preview */}
      {nextStep && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
          <ChevronRight className="w-3 h-3" />
          <span>Nästa: {STEP_TYPE_LABELS[nextStep.step_type]}</span>
          <span className="opacity-60">({getStepDescription(nextStep)})</span>
        </div>
      )}
      
      {/* Processing indicator */}
      {isProcessing && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Bearbetar...</span>
        </div>
      )}
    </div>
  );
}
