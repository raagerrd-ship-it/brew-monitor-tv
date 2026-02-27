import { Thermometer, Clock, Activity, ArrowDown, ArrowUp, ChevronRight, Loader2, AlertCircle, Hand } from "lucide-react";
import { FermentationProfileStep, STEP_TYPE_LABELS, getStepTypeLabel } from "@/types/fermentation";

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
  currentSg?: number | null;
  targetSg?: number | null;
  sgComparison?: string | null;
  originalGravity?: number | null;
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
  currentSg,
  targetSg,
  sgComparison,
  originalGravity,
}: FermentationStepDisplayProps) {
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
      case 'wait_for_acknowledgement': return <Hand className="h-3 w-3" />;
      case 'diacetyl_rest': return <Activity className="h-3 w-3" />;
      case 'gradual_ramp': return <Activity className="h-3 w-3" />;
      default: return <Clock className="h-3 w-3" />;
    }
  };

  const getStepDescription = (step: FermentationProfileStep) => {
    const rampArrow = step.step_type === 'ramp' && step === currentStep 
      ? (isRampingUp ? '↗' : '↘')
      : (step.step_type === 'ramp' ? '↘' : '');
    
    switch (step.step_type) {
      case 'hold':
        if (step.target_sg != null) {
          return `${step.target_temp ?? '—'}° tills SG ${step.sg_comparison === 'at_or_below' ? '≤' : '≥'} ${step.target_sg}`;
        }
        return `${step.target_temp}° i ${step.duration_hours}h`;
      case 'ramp':
        return `${step.ramp_type === 'immediate' ? '→' : rampArrow} ${step.target_temp}°`;
      case 'wait_for_temp':
        return `${step.target_temp}° (temperatur nådd)`;
      case 'wait_for_gravity_stable':
        return `Stabil SG ${step.gravity_stable_days}d`;
      case 'wait_for_sg':
        return `SG ${step.sg_comparison === 'at_or_below' ? '≤' : '≥'} ${step.target_sg}`;
      case 'wait_for_acknowledgement':
        return 'Väntar på kvittering';
      case 'diacetyl_rest':
        return `Diacetylvila +${(step as any).temp_increase ?? 3}° vid ${(step as any).attenuation_trigger ?? 75}%`;
      case 'gradual_ramp': {
        const minRamp = (step as any).min_ramp_hours;
        const curve = (step as any).ramp_curve === 'exponential' ? ' exp' : '';
        const rampInfo = minRamp ? ` (≥${minRamp}h${curve})` : (curve ? ` (${curve.trim()})` : '');
        return `Smart vila +${(step as any).temp_increase ?? 3}°${rampInfo} vid aktivitet <${(step as any).activity_trigger ?? 35}%`;
      }
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

  // Calculate SG progress for display
  const sgProgress = (() => {
    const stepTargetSg = currentStep.target_sg ?? targetSg;
    if (stepTargetSg == null || currentSg == null || originalGravity == null) return null;
    if (originalGravity <= stepTargetSg) return null;
    const totalDrop = originalGravity - stepTargetSg;
    const currentDrop = originalGravity - currentSg;
    return Math.max(0, Math.min(1, currentDrop / totalDrop));
  })();

  const getNextStepCondition = (step: FermentationProfileStep) => {
    switch (step.step_type) {
      case 'hold': {
        // Check if this is a SG-conditioned hold (no duration but has target_sg from step OR session props)
        const stepTargetSg = step.target_sg ?? targetSg;
        const stepSgComparison = step.sg_comparison ?? sgComparison;
        
        if (stepTargetSg != null && !step.duration_hours) {
          if (currentSg != null) {
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
        return `Nå ${step.target_temp}°`;
      case 'wait_for_gravity_stable':
        return `Stabil i ${step.gravity_stable_days}d`;
      case 'wait_for_sg':
        return `SG ${step.sg_comparison === 'at_or_below' ? '≤' : '≥'} ${step.target_sg}`;
      case 'wait_for_acknowledgement':
        return 'Kvittera för att fortsätta';
      case 'diacetyl_rest':
        return 'Väntar på SG-stabilitet';
      case 'gradual_ramp':
        return 'Gradvis ramp → SG-stabilitet';
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
              <div className="text-xs font-medium">
                {getStepTypeLabel(currentStep.step_type)}
              </div>
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
                  <span className="text-muted-foreground">{Math.round(stepStartTemp)}°</span>
                  <span className="text-muted-foreground">→</span>
                </>
              )}
              
              <span className={`font-medium ${waitingForTemp ? 'text-blue-400' : isRamping ? 'text-amber-500' : 'text-primary'}`}>
                {targetTemp.toFixed(1)}°
              </span>
              
              {isRamping && currentStep.target_temp && Math.abs(targetTemp - currentStep.target_temp) > 0.1 && (
                <>
                  <span className="text-muted-foreground">→</span>
                  <span className="text-primary/70">{currentStep.target_temp}°</span>
                </>
              )}
              
              {currentTemp != null && (
                <>
                  <span className="text-muted-foreground/40 mx-1">|</span>
                  <span className="text-muted-foreground">
                    Aktuell: <span className={`font-medium ${waitingForTemp ? 'text-blue-400' : 'text-foreground'}`}>{currentTemp.toFixed(1)}°</span>
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
              Tid klar, väntar på att temperaturen når {currentStep.target_temp}° 
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
          <span>Nästa: {getStepTypeLabel(nextStep.step_type)}</span>
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
