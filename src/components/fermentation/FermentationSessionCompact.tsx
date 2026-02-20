import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowDown, ArrowUp, Thermometer, Clock, Activity, Timer, Loader2, CheckCircle2, Check, Hand } from "lucide-react";
import { FermentationProfileStep, STEP_TYPE_LABELS } from "@/types/fermentation";
import { useFermentationProgress } from "./hooks/useFermentationProgress";
import { ProgressOverlay, PulseOverlay, ShimmerOverlay } from "./SessionProgressOverlays";
import { SessionStatusIcon } from "./SessionStatusIcon";
import { 
  getBackgroundStyle, 
  getBorderColor, 
  getBoxShadow,
  getTopReflection,
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
  profileStepTarget?: number | null;
  currentTemp?: number | null;
  isRamping: boolean;
  rampProgress: number | null;
  currentSg?: number | null;
  targetSg?: number | null;
  sgComparison?: string | null;
  originalGravity?: number | null;
  sgData?: SgDataPoint[];
  isWaitingForGravityStable?: boolean;
  onAcknowledge?: () => void;
  onAcknowledgeStep?: () => void;
  acknowledgeLoading?: boolean;
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
  sgData,
  isWaitingForGravityStable = false,
  onAcknowledge,
  onAcknowledgeStep,
  acknowledgeLoading,
}: FermentationSessionCompactProps) {

  // Calculate the effective profile target by looking back through steps
  const effectiveStepTarget = (() => {
    if (currentStep?.target_temp != null) return currentStep.target_temp;
    // No target on current step - look back through previous steps
    // We need step data from the parent, but we only have currentStep
    // Use targetTemp as fallback if no step target
    return null;
  })();

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

  const getStepIconWithColor = (stepType: string) => {
    const iconClass = "h-3 w-3";
    switch (stepType) {
      case 'ramp': return { icon: isRampingUp ? <ArrowUp className={iconClass} /> : <ArrowDown className={iconClass} />, color: 'hsl(38 92% 60%)' };
      case 'hold': return { icon: <Thermometer className={iconClass} />, color: 'hsl(142 70% 60%)' };
      case 'wait_for_temp': return { icon: <Thermometer className={iconClass} />, color: 'hsl(200 90% 60%)' };
      case 'wait_for_gravity_stable': return { icon: <Activity className={iconClass} />, color: 'hsl(280 70% 70%)' };
      case 'wait_for_sg': return { icon: <Activity className={iconClass} />, color: 'hsl(280 70% 70%)' };
      case 'wait_for_acknowledgement': return { icon: <Hand className={iconClass} />, color: 'hsl(38 92% 60%)' };
      default: return { icon: <Clock className={iconClass} />, color: 'hsl(var(--muted-foreground))' };
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
          return `Mål-SG ${stepSgComparison === 'at_or_below' ? '≤' : '≥'} ${stepTargetSg.toFixed(4)}`;
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
          const { days, hours, stableSince } = stabilityDuration;
          const required = step.gravity_stable_days ?? 0;
          const totalHours = days * 24 + hours;
          const requiredHours = required * 24;
          let sinceStr = '';
          if (stableSince) {
            const today = new Date();
            const isToday = stableSince.toDateString() === today.toDateString();
            if (isToday) {
              sinceStr = ` (sedan ${stableSince.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })})`;
            } else {
              sinceStr = ` (sedan ${stableSince.toLocaleDateString('sv-SE')} ${stableSince.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })})`;
            }
          }
          return `Stabil ${totalHours}h / ${requiredHours}h${sinceStr}`;
        }
        const requiredHours = (step.gravity_stable_days ?? 0) * 24;
        return `Stabil i ${requiredHours}h`;
      }
      case 'wait_for_sg':
        return `SG ${step.sg_comparison === 'at_or_below' ? '≤' : '≥'} ${step.target_sg?.toFixed(4) ?? ''}`;
      case 'wait_for_acknowledgement':
        return 'Väntar på kvittering';
      default:
        return '';
    }
  };

  const visualState: VisualState = status === 'completed' ? 'normal' : waitingForTemp ? 'waiting' : isRamping ? 'ramping' : 'normal';
  const isCompleted = status === 'completed';

  // Completed session - simplified view
  if (isCompleted) {
    return (
      <div 
        className="relative flex items-center gap-2 px-3 py-2 rounded-lg overflow-hidden backdrop-blur-md transition-all duration-300"
        style={{
          background: 'linear-gradient(135deg, hsl(142 70% 30% / 0.3) 0%, hsl(142 70% 20% / 0.2) 100%)',
          border: '1px solid hsl(142 70% 50% / 0.4)',
          boxShadow: '0 0 20px hsl(142 70% 50% / 0.15), inset 0 1px 0 hsl(142 70% 70% / 0.1)',
        }}
      >
        {/* Success shimmer overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(90deg, transparent 0%, hsl(142 70% 50% / 0.1) 50%, transparent 100%)',
            backgroundSize: '200% 100%',
          }}
        />
        
        {/* Checkmark icon */}
        <div className="relative z-10 shrink-0">
          <div 
            className="w-6 h-6 rounded-full flex items-center justify-center"
            style={{
              background: 'hsl(142 70% 45% / 0.3)',
              border: '1px solid hsl(142 70% 50% / 0.5)',
            }}
          >
            <CheckCircle2 className="h-4 w-4" style={{ color: 'hsl(142 70% 60%)' }} />
          </div>
        </div>
        
        {/* Content */}
        <div className="relative z-10 flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span 
              className="text-sm font-bold tracking-tight truncate"
              style={{ 
                color: 'hsl(142 70% 60%)',
                textShadow: '0 0 15px hsl(142 70% 50% / 0.4), 0 2px 4px hsl(0 0% 0% / 0.4)',
              }}
            >
              {profileName}
            </span>
            <Badge 
              variant="outline"
              className="shrink-0 text-xs font-medium px-1.5 py-0"
              style={{
                borderColor: 'hsl(142 70% 50% / 0.4)',
                background: 'hsl(142 70% 50% / 0.15)',
                color: 'hsl(142 70% 65%)',
              }}
            >
              <CheckCircle2 className="h-3 w-3 mr-0.5" />
              Klar
            </Badge>
            
            {/* Acknowledge button */}
            {onAcknowledge && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onAcknowledge();
                }}
                disabled={acknowledgeLoading}
                className="h-5 px-2 text-xs font-medium gap-1 ml-auto"
                style={{
                  color: 'hsl(142 70% 70%)',
                  background: 'hsl(142 70% 50% / 0.15)',
                }}
              >
                {acknowledgeLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <>
                    <Check className="h-3 w-3" />
                    Kvittera
                  </>
                )}
              </Button>
            )}
          </div>
          
          <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
            <span className="font-medium">Alla {totalSteps} steg slutförda</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="relative flex items-center gap-2.5 px-3 py-2.5 rounded-lg overflow-hidden backdrop-blur-md transition-all duration-300"
      style={{
        background: getBackgroundStyle(visualState),
        border: `1px solid ${getBorderColor(visualState)}`,
        boxShadow: getBoxShadow(visualState),
        minHeight: '72px',
      }}
    >
      {/* Top light reflection - glassmorphism effect */}
      <div 
        className="absolute inset-x-0 top-0 h-[1px] pointer-events-none z-20"
        style={{ background: getTopReflection() }}
      />
      
      {/* Progress overlays */}
      <ProgressOverlay progress={sgProgress} color="green" />
      {isRamping && !waitingForTemp && <ProgressOverlay progress={rampProgress} color="amber" />}
      {currentStep?.step_type === 'wait_for_gravity_stable' && (
        <ProgressOverlay progress={stabilityProgress} color="purple" />
      )}
      
      <ShimmerOverlay />
      
      {/* Status icon */}
      <div className="relative z-10 shrink-0">
        <SessionStatusIcon
          status={status}
          waitingForTemp={waitingForTemp}
          isRamping={isRamping}
          isRampingUp={isRampingUp}
          isTvMode={true}
          stepType={currentStep?.step_type}
        />
      </div>
      
      {/* Content */}
      <div className="relative z-10 flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span 
            className="font-bold tracking-tight truncate"
            style={{ 
              fontSize: '14px',
              color: 'hsl(var(--primary))',
              textShadow: '0 0 20px hsl(var(--primary) / 0.4), 0 2px 6px hsl(0 0% 0% / 0.4)',
            }}
          >
            {profileName}
          </span>
          <div className="flex-1" />
          {(() => {
            const progress = totalSteps > 0 ? (currentStepIndex + 1) / totalSteps : 0;
            return (
              <Badge 
                variant="outline"
                className="shrink-0 font-medium border-primary/30 px-2 py-0.5"
                style={{ 
                  fontSize: '14px',
                  background: `linear-gradient(135deg, hsl(var(--primary) / ${0.05 + progress * 0.25}) 0%, hsl(var(--primary) / ${0.02 + progress * 0.15}) 100%)`,
                  boxShadow: progress > 0.5 ? `0 0 8px hsl(var(--primary) / ${progress * 0.2})` : undefined,
                }}
              >
                {currentStepIndex + 1} / {totalSteps}
              </Badge>
            );
          })()}
          {waitingForTemp && (
            <Badge 
              variant="outline"
              className="shrink-0 text-xs font-medium flex items-center gap-0.5 px-1.5 py-0"
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
          {onAcknowledgeStep && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onAcknowledgeStep();
              }}
              disabled={acknowledgeLoading}
              className="h-5 px-2 text-xs font-medium gap-1"
              style={{
                color: 'hsl(38 92% 70%)',
                background: 'hsl(38 92% 50% / 0.15)',
                borderColor: 'hsl(38 92% 50% / 0.3)',
              }}
            >
              {acknowledgeLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <>
                  <Check className="h-3 w-3" />
                  Kvittera
                </>
              )}
            </Button>
          )}
        </div>
        
        {currentStep && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1" style={{ fontSize: '12px' }}>
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
                    Mål: {sgComparison === 'at_or_below' ? '≤' : ''}{targetSg.toFixed(4)}
                  </span>
                </span>
              </>
            )}
            
            <Separator />
            
            {/* Step type label + next step condition */}
            {(() => {
              const { icon, color } = getStepIconWithColor(currentStep.step_type);
              return (
                <span className="flex items-center gap-1" style={{ color }}>
                  {icon}
                  <span className="font-semibold">{STEP_TYPE_LABELS[currentStep.step_type]}</span>
                </span>
              );
            })()}
            <Separator />
            <span className="flex items-center gap-1 text-muted-foreground/80">
              <span className="font-medium">{getNextStepCondition(currentStep)}</span>
            </span>

            {/* Progress percentage - after condition text */}
            {isRamping && !waitingForTemp && rampProgress !== null && (
              <span className="text-muted-foreground font-medium">{Math.round(rampProgress * 100)}%</span>
            )}
            {currentStep?.step_type === 'wait_for_gravity_stable' && stabilityProgress !== null && (
              <span className="text-muted-foreground font-medium">{Math.round(stabilityProgress * 100)}%</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Small sub-components to reduce main component size
function Separator() {
  return <span className="shrink-0 text-muted-foreground/40 font-light select-none" style={{ fontSize: '10px' }}>│</span>;
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
        <>
          {currentStep.target_temp != null && currentStep.target_temp !== targetTemp && (
            <span 
              className="font-semibold"
              style={{ color: 'hsl(var(--primary))' }}
            >
              {currentStep.target_temp.toFixed(1)}°C
            </span>
          )}
          {currentStep.target_temp != null && currentStep.target_temp !== targetTemp && targetTemp != null && (
            <span className="text-muted-foreground/40">→</span>
          )}
          {targetTemp != null && (
            <span 
              className={currentStep.target_temp != null && currentStep.target_temp !== targetTemp ? "font-medium text-muted-foreground/70" : "font-semibold"}
              style={currentStep.target_temp == null || currentStep.target_temp === targetTemp 
                ? { color: waitingForTemp ? 'hsl(200 90% 60%)' : 'hsl(var(--primary))' } 
                : undefined}
            >
              {targetTemp.toFixed(1)}°
            </span>
          )}
        </>
      )}
    </span>
  );
}
