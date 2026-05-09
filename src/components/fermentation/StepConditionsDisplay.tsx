import { memo } from "react";
import { Activity, Thermometer, Clock, Beaker, CheckCircle2, Target } from "lucide-react";
import { FermentationProfileStep, getStepTypeLabel } from "@/types/fermentation";
import { Progress } from "@/components/ui/progress";

interface SgDataPoint {
  date: string;
  value: number;
  temp: number;
}

interface StepConditionsDisplayProps {
  currentStep: FermentationProfileStep;
  stepStartedAt: string;
  stepStartTemp?: number | null;
  currentTemp?: number | null;
  profileTargetTemp?: number | null;
  currentSg?: number | null;
  originalGravity?: number | null;
  activityScore?: number | null;
  attenuation?: number | null;
  sgData?: SgDataPoint[];
}

interface Condition {
  label: string;
  icon: React.ReactNode;
  current: string;
  target: string;
  progress: number; // 0-1
  met: boolean;
  color: string;
}

export const StepConditionsDisplay = memo(function StepConditionsDisplay({
  currentStep,
  stepStartedAt,
  stepStartTemp,
  currentTemp,
  profileTargetTemp,
  currentSg,
  originalGravity,
  activityScore,
  attenuation,
  sgData,
}: StepConditionsDisplayProps) {
  const conditions: Condition[] = [];
  const iconClass = "w-3 h-3 shrink-0";

  const stepType = currentStep.step_type;

  // Time condition (hold, ramp)
  if (currentStep.duration_hours && (stepType === 'hold' || stepType === 'ramp')) {
    const stepStarted = new Date(stepStartedAt);
    const elapsedHours = (Date.now() - stepStarted.getTime()) / (1000 * 60 * 60);
    const progress = Math.min(elapsedHours / currentStep.duration_hours, 1);
    const remaining = Math.max(0, currentStep.duration_hours - elapsedHours);
    const hours = Math.floor(remaining);
    const mins = Math.round((remaining - hours) * 60);

    conditions.push({
      label: 'Tid',
      icon: <Clock className={iconClass} />,
      current: progress >= 1 ? 'Klar' : `${hours > 0 ? `${hours}h ` : ''}${mins}m kvar`,
      target: `${currentStep.duration_hours}h`,
      progress,
      met: progress >= 1,
      color: 'hsl(var(--primary))',
    });
  }

  // Temperature condition (ramp target)
  if (stepType === 'ramp' && currentStep.target_temp != null && currentTemp != null) {
    const diff = Math.abs(currentTemp - currentStep.target_temp);
    const startDiff = stepStartTemp != null ? Math.abs(stepStartTemp - currentStep.target_temp) : diff + 1;
    const progress = startDiff > 0 ? Math.max(0, Math.min(1, 1 - diff / startDiff)) : (diff <= 0.5 ? 1 : 0);

    conditions.push({
      label: 'Temperatur',
      icon: <Thermometer className={iconClass} />,
      current: `${currentTemp.toFixed(1)}°`,
      target: `${currentStep.target_temp}°`,
      progress,
      met: diff <= 0.5,
      color: diff <= 0.5 ? 'hsl(142 70% 50%)' : diff <= 2 ? 'hsl(38 92% 55%)' : 'hsl(200 90% 55%)',
    });
  }

  // Temperature proximity for hold steps
  if (stepType === 'hold' && profileTargetTemp != null && currentTemp != null) {
    const diff = Math.abs(currentTemp - profileTargetTemp);
    conditions.push({
      label: 'Temperatur',
      icon: <Thermometer className={iconClass} />,
      current: `${currentTemp.toFixed(1)}°`,
      target: `${profileTargetTemp.toFixed(1)}°`,
      progress: Math.max(0, Math.min(1, 1 - diff / 3)),
      met: diff <= 0.5,
      color: diff <= 0.5 ? 'hsl(142 70% 50%)' : 'hsl(38 92% 55%)',
    });
  }

  // SG condition (hold with target_sg, wait_for_sg)
  if ((stepType === 'hold' || stepType === 'wait_for_sg') && currentStep.target_sg != null) {
    const targetSg = currentStep.target_sg;
    if (currentSg != null && originalGravity != null && originalGravity > targetSg) {
      const totalDrop = originalGravity - targetSg;
      const currentDrop = originalGravity - currentSg;
      const progress = Math.max(0, Math.min(1, currentDrop / totalDrop));
      const comparison = currentStep.sg_comparison === 'at_or_below' ? '≤' : '≥';
      const met = currentStep.sg_comparison === 'at_or_below' ? currentSg <= targetSg : currentSg >= targetSg;

      conditions.push({
        label: 'Densitet',
        icon: <Beaker className={iconClass} />,
        current: currentSg.toFixed(4),
        target: `${comparison} ${targetSg.toFixed(4)}`,
        progress,
        met,
        color: met ? 'hsl(142 70% 50%)' : 'hsl(280 70% 60%)',
      });
    }
  }

  // Gravity stability (wait_for_gravity_stable, gradual_ramp triggered, diacetyl_rest triggered)
  if (stepType === 'wait_for_gravity_stable' || 
      ((stepType === 'gradual_ramp' || stepType === 'diacetyl_rest') && activityScore != null)) {
    
    // Calculate stability from sgData
    if (sgData && sgData.length >= 2 && currentStep.gravity_stable_days) {
      const threshold = currentStep.gravity_threshold ?? 0.001;
      const sorted = [...sgData].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      // Mirrors backend isGravityStable exactly: walk back from the newest
      // reading; break as soon as an older reading exceeds latest + threshold.
      const currentSgVal = sorted[0].value;
      let stableFrom = new Date(sorted[0].date);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].value > currentSgVal + threshold) break;
        stableFrom = new Date(sorted[i].date);
      }
      
      const stableHours = (Date.now() - stableFrom.getTime()) / (1000 * 60 * 60);
      const requiredHours = currentStep.gravity_stable_days * 24;
      const progress = Math.min(stableHours / requiredHours, 1);
      const stableDays = Math.floor(stableHours / 24);
      const stableH = Math.floor(stableHours % 24);

      // Always show SG-stability for steps that require it for completion,
      // so the user can see when it's the blocker (e.g. activity is low but
      // SG hasn't been stable long enough).
      if (stepType === 'wait_for_gravity_stable' || stepType === 'gradual_ramp' || stepType === 'diacetyl_rest') {
        conditions.push({
          label: 'SG-stabilitet',
          icon: <Activity className={iconClass} />,
          current: `${stableDays > 0 ? `${stableDays}d ` : ''}${stableH}h stabil`,
          target: `${currentStep.gravity_stable_days}d`,
          progress,
          met: progress >= 1,
          color: 'hsl(280 70% 60%)',
        });
      }
    }
  }

  // Activity trigger (gradual_ramp)
  if (stepType === 'gradual_ramp' && activityScore != null) {
    const trigger = currentStep.activity_trigger ?? 35;
    const met = activityScore <= trigger;
    // Progress: 100% activity = 0, trigger = 1.0
    const progress = Math.max(0, Math.min(1, 1 - (activityScore - trigger) / (100 - trigger)));

    conditions.push({
      label: 'Aktivitet',
      icon: <Activity className={iconClass} />,
      current: `${Math.round(activityScore)}%`,
      target: `< ${trigger}%`,
      progress,
      met,
      color: met ? 'hsl(142 70% 50%)' : 'hsl(38 92% 55%)',
    });
  }

  // Attenuation trigger (diacetyl_rest)
  if (stepType === 'diacetyl_rest' && attenuation != null) {
    const trigger = currentStep.attenuation_trigger ?? 75;
    const progress = Math.min(1, attenuation / trigger);
    const met = attenuation >= trigger;

    conditions.push({
      label: 'Attenuation',
      icon: <Target className={iconClass} />,
      current: `${Math.round(attenuation)}%`,
      target: `≥ ${trigger}%`,
      progress,
      met,
      color: met ? 'hsl(142 70% 50%)' : 'hsl(38 92% 55%)',
    });
  }

  // Low activity for completion (gradual_ramp, diacetyl_rest)
  if ((stepType === 'gradual_ramp' || stepType === 'diacetyl_rest') && activityScore != null) {
    const met = activityScore <= 5;
    conditions.push({
      label: 'Aktivitet (klar)',
      icon: <Activity className={iconClass} />,
      current: `${Math.round(activityScore)}%`,
      target: '< 5%',
      progress: Math.max(0, Math.min(1, 1 - (activityScore - 5) / 95)),
      met,
      color: met ? 'hsl(142 70% 50%)' : 'hsl(var(--muted-foreground))',
    });
  }

  if (conditions.length === 0) return null;

  return (
    <div 
      className="space-y-2 rounded-lg p-3"
      style={{
        background: 'hsl(0 0% 0% / 0.15)',
        border: '1px solid hsl(0 0% 100% / 0.05)',
      }}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
        <Target className="w-3 h-3" />
        Villkor för stegkomplettering
      </div>
      
      <div className="space-y-2.5">
        {conditions.map((c, i) => (
          <div key={i} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5" style={{ color: c.color }}>
                {c.icon}
                <span className="font-medium">{c.label}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold" style={{ color: c.met ? 'hsl(142 70% 55%)' : c.color }}>
                  {c.current}
                </span>
                <span className="text-muted-foreground/60">→</span>
                <span className="text-muted-foreground">{c.target}</span>
                {c.met && <CheckCircle2 className="w-3 h-3" style={{ color: 'hsl(142 70% 55%)' }} />}
              </div>
            </div>
            <Progress 
              value={c.progress * 100} 
              className="h-1" 
              indicatorClassName={c.met ? '' : ''}
              indicatorStyle={{ background: c.met ? 'hsl(142 70% 50%)' : c.color }}
              style={{ background: 'hsl(0 0% 100% / 0.06)' }}
            />
          </div>
        ))}
      </div>
    </div>
  );
});
