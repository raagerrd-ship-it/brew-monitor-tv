import { memo } from "react";
import { Thermometer, Clock, ArrowDown, ArrowUp, Activity, Hand, Beaker, Zap } from "lucide-react";
import { FermentationProfileStep, getStepTypeLabel } from "@/types/fermentation";
import { Progress } from "@/components/ui/progress";

interface StepExecutionDisplayProps {
  currentStep: FermentationProfileStep;
  stepStartedAt: string;
  stepStartTemp?: number | null;
  currentTemp?: number | null;
  targetTemp?: number | null;
  profileTargetTemp?: number | null;
  isRamping: boolean;
  rampProgress: number | null;
  rampTriggeredAt?: string | null;
  currentSg?: number | null;
  originalGravity?: number | null;
  activityScore?: number | null;
  attenuation?: number | null;
}

interface ExecutionItem {
  label: string;
  icon: React.ReactNode;
  value: string;
  detail?: string;
  progress?: number; // 0-1, undefined = no bar
  color: string;
}

export const StepExecutionDisplay = memo(function StepExecutionDisplay({
  currentStep,
  stepStartedAt,
  stepStartTemp,
  currentTemp,
  targetTemp,
  profileTargetTemp,
  isRamping,
  rampProgress,
  rampTriggeredAt,
  currentSg,
  originalGravity,
  activityScore,
  attenuation,
}: StepExecutionDisplayProps) {
  const items: ExecutionItem[] = [];
  const iconClass = "w-3 h-3 shrink-0";
  const stepType = currentStep.step_type;

  // Step type label
  const stepLabel = getStepTypeLabel(stepType);

  // --- Temperature ---
  const isGradualOrDiacetyl = stepType === 'gradual_ramp' || stepType === 'diacetyl_rest';
  const finalTarget = isGradualOrDiacetyl && stepStartTemp != null && currentStep.temp_increase != null
    ? stepStartTemp + currentStep.temp_increase
    : null;
  const effectiveTarget = profileTargetTemp ?? targetTemp ?? currentStep.target_temp;

  if (isGradualOrDiacetyl && finalTarget != null && stepStartTemp != null) {
    // Temp ramp: "19° → 22°" with "Mål nu 21.6°"
    const tempProgress = effectiveTarget != null
      ? Math.max(0, Math.min(1, (effectiveTarget - stepStartTemp) / (finalTarget - stepStartTemp)))
      : 0;
    items.push({
      label: 'Temp.ramp',
      icon: <Thermometer className={iconClass} />,
      value: `${Math.round(stepStartTemp)}° → ${Math.round(finalTarget)}°`,
      detail: effectiveTarget != null ? `Mål nu ${effectiveTarget.toFixed(1)}°` : undefined,
      progress: tempProgress,
      color: 'hsl(38 92% 55%)',
    });
  } else {
    // Standard temp display for non-gradual steps
    const displayTarget = effectiveTarget ?? currentStep.target_temp;
    if (displayTarget != null) {
      const tempItem: ExecutionItem = {
        label: 'Måltemp',
        icon: <Thermometer className={iconClass} />,
        value: `${displayTarget.toFixed(1)}°`,
        color: 'hsl(var(--primary))',
      };
      if (currentTemp != null) {
        const diff = Math.abs(currentTemp - displayTarget);
        tempItem.detail = `Aktuell ${currentTemp.toFixed(1)}°`;
        tempItem.progress = Math.max(0, Math.min(1, 1 - diff / 5));
        tempItem.color = diff <= 0.5 ? 'hsl(142 70% 50%)' : diff <= 2 ? 'hsl(38 92% 55%)' : 'hsl(var(--primary))';
      }
      items.push(tempItem);
    }
  }

  // --- Ramp progress (for ramp steps) ---
  if (stepType === 'ramp' && isRamping && rampProgress != null) {
    const isUp = stepStartTemp != null && currentStep.target_temp != null && currentStep.target_temp > stepStartTemp;
    items.push({
      label: isUp ? 'Rampar upp' : 'Rampar ner',
      icon: isUp ? <ArrowUp className={iconClass} /> : <ArrowDown className={iconClass} />,
      value: `${Math.round(rampProgress * 100)}%`,
      detail: stepStartTemp != null && currentStep.target_temp != null
        ? `${Math.round(stepStartTemp)}° → ${currentStep.target_temp}°`
        : undefined,
      progress: rampProgress,
      color: 'hsl(38 92% 55%)',
    });
  }

  // --- Time elapsed ---
  if (currentStep.duration_hours && (stepType === 'hold' || stepType === 'ramp')) {
    const stepStarted = new Date(stepStartedAt);
    const elapsedHours = (Date.now() - stepStarted.getTime()) / (1000 * 60 * 60);
    const remaining = Math.max(0, currentStep.duration_hours - elapsedHours);
    const hours = Math.floor(remaining);
    const mins = Math.round((remaining - hours) * 60);
    const progress = Math.min(elapsedHours / currentStep.duration_hours, 1);

    items.push({
      label: 'Tid',
      icon: <Clock className={iconClass} />,
      value: progress >= 1 ? 'Klar' : `${hours > 0 ? `${hours}h ` : ''}${mins}m kvar`,
      detail: `av ${currentStep.duration_hours}h`,
      progress,
      color: 'hsl(var(--primary))',
    });
  }

  // --- Gradual ramp phase ---
  if (stepType === 'gradual_ramp') {
    const trigger = currentStep.activity_trigger ?? 35;
    const triggered = rampTriggeredAt != null;
    
    if (!triggered && activityScore != null) {
      items.push({
        label: 'Fas',
        icon: <Activity className={iconClass} />,
        value: 'Väntar på trigger',
        detail: `Aktivitet ${Math.round(activityScore)}% → <${trigger}%`,
        color: 'hsl(280 70% 60%)',
      });
    } else if (triggered) {
      const minHours = currentStep.min_ramp_hours;
      if (minHours && rampTriggeredAt) {
        const rampStart = new Date(rampTriggeredAt);
        const rampElapsed = (Date.now() - rampStart.getTime()) / (1000 * 60 * 60);
        const rampProg = Math.min(rampElapsed / minHours, 1);
        items.push({
          label: 'Tid.ramp',
          icon: <Clock className={iconClass} />,
          value: `≥${minHours}h`,
          detail: `Tid nu ${Math.round(rampElapsed)}h`,
          progress: rampProg,
          color: 'hsl(38 92% 55%)',
        });
      }
    }
  }

  // --- Diacetyl rest phase ---
  if (stepType === 'diacetyl_rest') {
    const trigger = currentStep.attenuation_trigger ?? 75;
    const triggered = attenuation != null && attenuation >= trigger;
    const tempIncrease = currentStep.temp_increase ?? 3;

    if (!triggered) {
      items.push({
        label: 'Fas',
        icon: <Beaker className={iconClass} />,
        value: 'Väntar på trigger',
        detail: `Att. ${attenuation != null ? Math.round(attenuation) : '—'}% → ≥${trigger}%`,
        color: 'hsl(280 70% 60%)',
      });
    } else {
      items.push({
        label: 'Diacetylvila',
        icon: <Zap className={iconClass} />,
        value: `+${tempIncrease}° aktiv`,
        detail: 'Väntar på SG-stabilitet',
        color: 'hsl(38 92% 55%)',
      });
    }
  }

  // --- SG target (hold with SG, wait_for_sg) ---
  if ((stepType === 'hold' || stepType === 'wait_for_sg') && currentStep.target_sg != null && currentSg != null) {
    const comparison = currentStep.sg_comparison === 'at_or_below' ? '≤' : '≥';
    items.push({
      label: 'Densitetsmål',
      icon: <Beaker className={iconClass} />,
      value: `${currentSg.toFixed(4)}`,
      detail: `${comparison} ${currentStep.target_sg.toFixed(4)}`,
      color: 'hsl(280 70% 60%)',
    });
  }

  // --- Gravity stability ---
  if (stepType === 'wait_for_gravity_stable') {
    items.push({
      label: 'Väntar',
      icon: <Activity className={iconClass} />,
      value: `Stabil i ${currentStep.gravity_stable_days ?? '?'}d`,
      color: 'hsl(280 70% 60%)',
    });
  }

  // --- Acknowledgement ---
  if (stepType === 'wait_for_acknowledgement') {
    items.push({
      label: 'Kvittering',
      icon: <Hand className={iconClass} />,
      value: 'Väntar på kvittering',
      color: 'hsl(38 92% 55%)',
    });
  }

  if (items.length === 0) return null;

  return (
    <div 
      className="space-y-2 rounded-lg p-3"
      style={{
        background: 'hsl(0 0% 0% / 0.15)',
        border: '1px solid hsl(0 0% 100% / 0.05)',
      }}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
        <Zap className="w-3 h-3" />
        {stepLabel} – pågår
      </div>
      
      <div className="space-y-2.5">
        {items.map((item, i) => (
          <div key={i} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5" style={{ color: item.color }}>
                {item.icon}
                <span className="font-medium">{item.label}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold" style={{ color: item.color }}>
                  {item.value}
                </span>
                {item.detail && (
                  <span className="text-muted-foreground text-[11px]">{item.detail}</span>
                )}
              </div>
            </div>
            {item.progress != null && (
              <Progress 
                value={item.progress * 100} 
                className="h-1" 
                indicatorStyle={{ background: item.color }}
                style={{ background: 'hsl(0 0% 100% / 0.06)' }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
});
