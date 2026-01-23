import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowDown, ArrowUp, Thermometer, Clock, Activity, Timer, SkipForward, Loader2 } from "lucide-react";
import { FermentationProfileStep, STEP_TYPE_LABELS } from "@/types/fermentation";
import { useTvMode } from "@/contexts/TvModeContext";
import { useFermentationProgress } from "./hooks/useFermentationProgress";
import { ProgressOverlay, PulseOverlay, ShimmerOverlay } from "./SessionProgressOverlays";
import { SessionStatusIcon } from "./SessionStatusIcon";
import { 
  getBackgroundStyle, 
  getBorderColor, 
  getBoxShadow, 
  formatRemainingTime,
  type VisualState 
} from "./sessionStyles";

interface SgDataPoint {
  date: string;
  value: number;
  temp: number;
}

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
  onSkipStep?: () => void;
  skipLoading?: boolean;
  sgData?: SgDataPoint[];
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
  isRamping: isRampingProp,
  rampProgress: rampProgressProp,
  currentSg,
  targetSg,
  sgComparison,
  originalGravity,
  onSkipStep,
  skipLoading,
  sgData,
}: FermentationSessionCompactProps) {
  const { isTvMode } = useTvMode();

  const progress = useFermentationProgress({
    currentStep,
    stepStartedAt,
    stepStartTemp,
    targetTemp,
    currentTemp,
    currentSg,
    targetSg,
    originalGravity,
    sgData,
  });

  const {
    stabilityDuration,
    stabilityProgress,
    sgProgress,
    waitingForTemp,
    tempDifference,
    isRampingUp,
  } = progress;

  // Use props for ramping state (passed from parent) or fall back to calculated
  const isRamping = isRampingProp;
  const rampProgress = rampProgressProp;

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

  const getNextStepCondition = (step: FermentationProfileStep) => {
    if (waitingForTemp && tempDifference) {
      return `Väntar på temp (${tempDifference}° kvar)`;
    }

    switch (step.step_type) {
      case 'hold': {
        const stepTargetSg = step.target_sg ?? targetSg;
        const stepSgComparison = step.sg_comparison ?? sgComparison;
        
        if (stepTargetSg != null && !step.duration_hours) {
          if (currentSg != null) {
            const progressPercent = sgProgress != null ? ` (${Math.round(sgProgress * 100)}%)` : '';
            return `Väntar på mål-SG${progressPercent}`;
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
      case 'wait_for_gravity_stable': {
        if (stabilityDuration) {
          const { days, hours } = stabilityDuration;
          const required = step.gravity_stable_days ?? 0;
          if (days >= 1) {
            return `Stabil ${days}d ${hours}h / ${required}d`;
          } else {
            return `Stabil ${hours}h / ${required}d`;
          }
        }
        return `Stabil i ${step.gravity_stable_days}d`;
      }
      case 'wait_for_sg':
        return `SG ${step.sg_comparison === 'at_or_below' ? '≤' : '≥'} ${step.target_sg?.toFixed(3) ?? ''}`;
      default:
        return '';
    }
  };

  const visualState: VisualState = waitingForTemp ? 'waiting' : isRamping ? 'ramping' : 'normal';

  return (
    <div 
      className="relative flex items-center gap-2 px-3 py-2 rounded-lg overflow-hidden backdrop-blur-md transition-all duration-300"
      style={{
        background: getBackgroundStyle(visualState),
        border: `1px solid ${getBorderColor(visualState)}`,
        boxShadow: getBoxShadow(visualState),
      }}
    >
      {/* Progress overlays */}
      <ProgressOverlay progress={sgProgress} color="green" />
      {isRamping && !waitingForTemp && <ProgressOverlay progress={rampProgress} color="amber" />}
      {currentStep?.step_type === 'wait_for_gravity_stable' && (
        <ProgressOverlay progress={stabilityProgress} color="purple" />
      )}
      {!isTvMode && <PulseOverlay active={waitingForTemp} color="blue" />}
      <ShimmerOverlay />
      
      {/* Status icon */}
      <div className="relative z-10 shrink-0">
        <SessionStatusIcon
          status={status}
          waitingForTemp={waitingForTemp}
          isRamping={isRamping}
          isRampingUp={isRampingUp}
          isTvMode={isTvMode}
        />
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
            <ProgressBadge progress={rampProgress} color="amber" />
          )}
          {currentStep?.step_type === 'wait_for_gravity_stable' && stabilityProgress !== null && (
            <ProgressBadge progress={stabilityProgress} color="purple" />
          )}
        </div>
        
        {currentStep && (
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-0.5 text-xs">
            {/* Temperature display */}
            <TemperatureDisplay
              currentStep={currentStep}
              isRamping={isRamping}
              stepStartTemp={stepStartTemp}
              targetTemp={targetTemp}
              waitingForTemp={waitingForTemp}
            />
            
            {/* SG target indicator */}
            {targetSg != null && (
              <>
                <Separator />
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
            
            <Separator />
            
            {/* Next step condition */}
            <span className="flex items-center gap-1 text-muted-foreground">
              {getStepIcon(currentStep.step_type)}
              <span className="font-medium">{getNextStepCondition(currentStep)}</span>
            </span>
            
            {/* Manual skip button */}
            {waitingForTemp && onSkipStep && (
              <>
                <Separator />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSkipStep();
                  }}
                  disabled={skipLoading}
                  className="h-5 px-1.5 text-xs font-medium gap-1"
                  style={{
                    color: 'hsl(200 90% 70%)',
                    background: 'hsl(200 90% 50% / 0.1)',
                  }}
                >
                  {skipLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <>
                      <SkipForward className="h-3 w-3" />
                      Hoppa
                    </>
                  )}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Small sub-components to reduce main component size
function Separator() {
  return <span className="w-1 h-1 rounded-full bg-muted-foreground/30 shrink-0" />;
}

interface ProgressBadgeProps {
  progress: number;
  color: 'amber' | 'purple';
}

function ProgressBadge({ progress, color }: ProgressBadgeProps) {
  const styles = {
    amber: { bg: 'hsl(38 92% 50% / 0.2)', text: 'hsl(38 92% 60%)' },
    purple: { bg: 'hsl(280 70% 50% / 0.2)', text: 'hsl(280 70% 70%)' },
  };
  
  return (
    <span 
      className="text-xs font-bold shrink-0 rounded px-1"
      style={{ background: styles[color].bg, color: styles[color].text }}
    >
      {Math.round(progress * 100)}%
    </span>
  );
}

interface TemperatureDisplayProps {
  currentStep: FermentationProfileStep;
  isRamping: boolean;
  stepStartTemp?: number | null;
  targetTemp: number | null;
  waitingForTemp: boolean;
}

function TemperatureDisplay({ 
  currentStep, 
  isRamping, 
  stepStartTemp, 
  targetTemp,
  waitingForTemp 
}: TemperatureDisplayProps) {
  const isRampingUp = currentStep?.step_type === 'ramp' && 
    currentStep.target_temp != null && 
    stepStartTemp != null && 
    currentStep.target_temp > stepStartTemp;

  return (
    <span className="flex items-center gap-1 shrink-0">
      <Thermometer 
        className="h-3 w-3 shrink-0"
        style={{ color: waitingForTemp ? 'hsl(200 90% 60%)' : 'hsl(var(--muted-foreground) / 0.7)' }}
      />
      
      {isRamping && stepStartTemp != null && currentStep?.target_temp != null ? (
        <>
          <span className="text-muted-foreground/70">
            {stepStartTemp.toFixed(0)}°
          </span>
          <span className="text-muted-foreground/40">→</span>
          
          {targetTemp != null && (
            <span 
              className="font-semibold"
              style={{ color: waitingForTemp ? 'hsl(200 90% 60%)' : 'hsl(38 92% 60%)' }}
            >
              {targetTemp.toFixed(1)}°C
            </span>
          )}
          
          <span className="text-muted-foreground/40">→</span>
          
          <span className="font-medium text-muted-foreground">
            {currentStep.target_temp.toFixed(0)}°
          </span>
        </>
      ) : (
        targetTemp != null && (
          <span 
            className="font-semibold"
            style={{ color: waitingForTemp ? 'hsl(200 90% 60%)' : 'hsl(var(--primary))' }}
          >
            {targetTemp.toFixed(1)}°C
          </span>
        )
      )}
    </span>
  );
}
