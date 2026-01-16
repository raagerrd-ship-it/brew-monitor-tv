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
      className="relative flex items-center gap-3 px-3 py-2.5 rounded-lg overflow-hidden backdrop-blur-md transition-all duration-300"
      style={{
        background: isRamping 
          ? 'linear-gradient(135deg, hsl(38 92% 50% / 0.12) 0%, hsl(var(--primary) / 0.08) 100%)'
          : 'linear-gradient(135deg, hsl(var(--primary) / 0.1) 0%, hsl(var(--primary) / 0.05) 100%)',
        border: `1px solid ${isRamping ? 'hsl(38 92% 50% / 0.25)' : 'hsl(var(--primary) / 0.2)'}`,
        boxShadow: isRamping 
          ? '0 4px 20px hsl(38 92% 50% / 0.15), inset 0 1px 0 hsl(0 0% 100% / 0.1)'
          : '0 4px 16px hsl(var(--primary) / 0.1), inset 0 1px 0 hsl(0 0% 100% / 0.08)',
      }}
    >
      {/* Animated ramp progress overlay */}
      {isRamping && rampProgress !== null && (
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
            <Pause className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
        ) : isRamping ? (
          <div 
            className="p-1.5 rounded-full animate-pulse"
            style={{ 
              background: 'linear-gradient(135deg, hsl(38 92% 50% / 0.3) 0%, hsl(38 92% 50% / 0.15) 100%)',
              boxShadow: '0 0 12px hsl(38 92% 50% / 0.4)'
            }}
          >
            <ArrowDown className="w-3.5 h-3.5 text-amber-400" />
          </div>
        ) : (
          <div 
            className="p-1.5 rounded-full"
            style={{ 
              background: 'linear-gradient(135deg, hsl(var(--primary) / 0.25) 0%, hsl(var(--primary) / 0.1) 100%)',
              boxShadow: '0 0 8px hsl(var(--primary) / 0.3)'
            }}
          >
            <Play className="w-3.5 h-3.5 text-primary" />
          </div>
        )}
      </div>
      
      {/* Content */}
      <div className="relative z-10 flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tracking-tight truncate" style={{ textShadow: '0 1px 2px hsl(0 0% 0% / 0.2)' }}>
            {profileName}
          </span>
          <Badge 
            variant="outline"
            className="text-[10px] px-2 py-0.5 h-5 shrink-0 font-medium border-primary/30 bg-primary/5"
          >
            {currentStepIndex + 1}/{totalSteps}
          </Badge>
          {isRamping && rampProgress !== null && (
            <span 
              className="text-[11px] font-bold shrink-0 px-1.5 py-0.5 rounded"
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
          <div className="flex items-center gap-2 text-xs mt-1">
            {/* Temperature display */}
            <span className="flex items-center gap-1">
              <Thermometer className="w-3.5 h-3.5 text-muted-foreground/70" />
              {targetTemp != null && (
                <span 
                  className="font-semibold"
                  style={{ 
                    color: isRamping ? 'hsl(38 92% 60%)' : 'hsl(var(--primary))',
                    textShadow: isRamping ? '0 0 8px hsl(38 92% 50% / 0.4)' : 'none'
                  }}
                >
                  {targetTemp.toFixed(1)}°C
                </span>
              )}
              {isRamping && currentStep.target_temp && 
               targetTemp != null && Math.abs(targetTemp - currentStep.target_temp) > 0.1 && (
                <>
                  <span className="text-muted-foreground/50">→</span>
                  <span className="text-primary/80 font-medium">{currentStep.target_temp}°C</span>
                </>
              )}
            </span>
            
            {/* Separator */}
            <span 
              className="w-1 h-1 rounded-full shrink-0"
              style={{ background: 'hsl(var(--muted-foreground) / 0.3)' }}
            />
            
            {/* Next step condition */}
            <span className="flex items-center gap-1 text-muted-foreground truncate">
              {getStepIcon(currentStep.step_type)}
              <span className="truncate font-medium">{getNextStepCondition(currentStep)}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
