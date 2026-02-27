import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { FermentationProfileStep, getStepTypeLabel } from "@/types/fermentation";
import { FermentationSessionData } from "@/types/brew";
import { Play, Pause, Square, Loader2, SkipForward, ChevronUp, Thermometer, Activity, Clock, ArrowDown, ArrowUp } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FermentationSessionCompact } from "./FermentationSessionCompact";
import { FermentationSessionHeader } from "./FermentationSessionHeader";
import { StepExecutionDisplay } from "./StepExecutionDisplay";
import { StepConditionsDisplay } from "./StepConditionsDisplay";
import { useDeferredRender, useActiveFermentationSession } from "@/hooks";
import { formatRemainingTime } from "./sessionStyles";

interface ActiveFermentationSessionProps {
  controllerId?: string;
  brewId?: string;
  compact?: boolean;
  preloadedSession?: FermentationSessionData | null;
  isAuthenticated?: boolean;
  currentSg?: number | null;
  originalGravity?: number | null;
  sgData?: Array<{ date: string; value: number; temp: number }>;
  activityScore?: number | null;
  fermentationPhase?: string | null;
  attenuation?: number | null;
  onExpandChange?: (expanded: boolean) => void;
}

export function ActiveFermentationSession({
  controllerId, brewId, compact = false, preloadedSession,
  isAuthenticated: isAuthenticatedProp, currentSg, originalGravity,
  sgData, activityScore, fermentationPhase, attenuation, onExpandChange,
}: ActiveFermentationSessionProps) {
  const shouldRender = useDeferredRender();
  const [expanded, setExpanded] = useState(false);
  const {
    session, controllerData, loading, actionLoading, skipLoading, acknowledgeLoading,
    showCancelDialog, setShowCancelDialog, showSkipConfirm, setShowSkipConfirm,
    isAuthenticated, handlePauseResume, handleCancel, handleSkipStep,
    handleAcknowledge, handleAcknowledgeStep,
    calculateProgress, calculateStepProgress, getRampProgress,
  } = useActiveFermentationSession({
    controllerId, brewId, compact, preloadedSession, isAuthenticated: isAuthenticatedProp, currentSg, originalGravity,
  });

  if (!shouldRender && compact) {
    return (
      <div className="rounded-lg border bg-card/50 p-3">
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (loading || !session) return null;

  const currentStep = session.steps?.[session.current_step_index];
  const progress = calculateProgress();
  const stepProgress = calculateStepProgress();
  const rampProgress = getRampProgress();
  const isRamping = rampProgress !== null && rampProgress < 1;

  const isWaitingForTemp = (() => {
    if (!currentStep || currentStep.step_type !== 'ramp' || !currentStep.duration_hours) return false;
    const stepStarted = new Date(session.step_started_at);
    const elapsedHours = (Date.now() - stepStarted.getTime()) / (1000 * 60 * 60);
    const timeComplete = elapsedHours >= currentStep.duration_hours;
    const tempReached = currentStep.target_temp != null && controllerData?.current_temp != null &&
      Math.abs(controllerData.current_temp - currentStep.target_temp) <= 0.5;
    return timeComplete && !tempReached;
  })();

  const isWaitingForGravityStable = currentStep?.step_type === 'wait_for_gravity_stable';
  const isWaitingForAcknowledgement = currentStep?.step_type === 'wait_for_acknowledgement';

  // Compact view
  if (compact) {
    const stepTargetSg = currentStep?.target_sg ?? null;
    const stepSgComparison = currentStep?.sg_comparison ?? null;
    const profileStepTarget = (() => {
      if (currentStep?.target_temp != null) return currentStep.target_temp;
      const steps = session.steps || [];
      for (let i = session.current_step_index - 1; i >= 0; i--) {
        if (steps[i]?.target_temp != null) return steps[i].target_temp;
      }
      return null;
    })();

    if (expanded && isAuthenticated) {
      // Calculate step-level time progress for gauge
      const stepTimeProgress = (() => {
        if (!currentStep?.duration_hours) return null;
        const stepStarted = new Date(session.step_started_at);
        const elapsed = (Date.now() - stepStarted.getTime()) / (1000 * 60 * 60);
        return Math.min(elapsed / currentStep.duration_hours, 1);
      })();

      const stepRemainingTime = (() => {
        if (!currentStep?.duration_hours) return null;
        const stepStarted = new Date(session.step_started_at);
        const elapsed = (Date.now() - stepStarted.getTime()) / (1000 * 60 * 60);
        return Math.max(0, currentStep.duration_hours - elapsed);
      })();

      const getStepGaugeColor = () => {
        if (isWaitingForTemp) return 'hsl(200 90% 55%)';
        if (isRamping) return 'hsl(38 92% 55%)';
        if (isWaitingForGravityStable) return 'hsl(280 70% 60%)';
        if (currentStep?.step_type === 'gradual_ramp' || currentStep?.step_type === 'diacetyl_rest') return 'hsl(38 92% 55%)';
        return 'hsl(142 70% 50%)';
      };

      const getStepGaugeValue = () => {
        if (isRamping && rampProgress != null) return rampProgress;
        if (stepTimeProgress != null) return stepTimeProgress;
        // For activity-based steps, show activity approaching trigger
        if (currentStep?.step_type === 'gradual_ramp' && activityScore != null) {
          const trigger = currentStep.activity_trigger ?? 35;
          return Math.max(0, Math.min(1, 1 - activityScore / 100));
        }
        if (currentStep?.step_type === 'diacetyl_rest' && attenuation != null) {
          const trigger = currentStep.attenuation_trigger ?? 75;
          return Math.min(1, (attenuation ?? 0) / trigger);
        }
        if (isWaitingForGravityStable && sgData) {
          // Use rough stability estimate
          return stepProgress > 0 ? stepProgress / 100 : 0.1;
        }
        return stepProgress / 100;
      };

      const getStepGaugeLabel = () => {
        if (isRamping && rampProgress != null) return `${Math.round(rampProgress * 100)}%`;
        if (stepTimeProgress != null) return `${Math.round(stepTimeProgress * 100)}%`;
        if (currentStep?.step_type === 'gradual_ramp' && activityScore != null) {
          return `${Math.round(activityScore)}%`;
        }
        if (currentStep?.step_type === 'diacetyl_rest' && attenuation != null) {
          return `${Math.round(attenuation)}%`;
        }
        return `${Math.round(stepProgress)}%`;
      };

      const getStepGaugeSubLabel = () => {
        if (stepRemainingTime != null && stepRemainingTime > 0) return formatRemainingTime(stepRemainingTime);
        if (isWaitingForTemp) return 'Väntar temp';
        if (isWaitingForGravityStable) return 'SG stabil';
        if (currentStep?.step_type === 'gradual_ramp') return `Akt. → ${currentStep.activity_trigger ?? 35}%`;
        if (currentStep?.step_type === 'diacetyl_rest') return `Att. → ${currentStep.attenuation_trigger ?? 75}%`;
        return getStepTypeLabel(currentStep?.step_type || 'hold');
      };

      const overallProgress = progress / 100;

      // Inline expanded view
      return (
        <div className="space-y-2">
          {/* Collapse button */}
          <button
            onClick={() => { setExpanded(false); onExpandChange?.(false); }}
            className="w-full flex items-center justify-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors py-0.5"
          >
            <ChevronUp className="w-3 h-3" />
            <span>Dölj</span>
          </button>

          <div 
            className="rounded-xl overflow-hidden backdrop-blur-md p-4 space-y-4"
            style={{
              background: 'linear-gradient(145deg, hsl(var(--primary) / 0.06) 0%, hsl(222 20% 12% / 0.85) 100%)',
              border: '1px solid hsl(var(--primary) / 0.15)',
              boxShadow: '0 8px 32px hsl(222 30% 3% / 0.5), inset 0 1px 0 hsl(0 0% 100% / 0.06)',
            }}
          >
            <FermentationSessionHeader
              profileName={session.profile?.name || ''}
              status={session.status}
              startedAt={session.started_at}
            />

            {/* Removed gauges - conditions display shows progress */}

            {currentStep && (
              <>
                <StepExecutionDisplay
                  currentStep={currentStep}
                  stepStartedAt={session.step_started_at}
                  stepStartTemp={session.step_start_temp}
                  currentTemp={controllerData?.current_temp ?? null}
                  targetTemp={controllerData?.target_temp ?? null}
                  profileTargetTemp={controllerData?.profile_target_temp ?? null}
                  isRamping={isRamping}
                  rampProgress={rampProgress}
                  rampTriggeredAt={session.ramp_triggered_at}
                  currentSg={currentSg}
                  originalGravity={originalGravity}
                  activityScore={activityScore}
                  attenuation={attenuation}
                />
                <StepConditionsDisplay
                  currentStep={currentStep}
                  stepStartedAt={session.step_started_at}
                  stepStartTemp={session.step_start_temp}
                  currentTemp={controllerData?.current_temp ?? null}
                  profileTargetTemp={controllerData?.profile_target_temp ?? null}
                  currentSg={currentSg}
                  originalGravity={originalGravity}
                  activityScore={activityScore}
                  attenuation={attenuation}
                  sgData={sgData}
                />
              </>
            )}

            {session.steps && session.steps.length > 0 && (
              <StepsOverview steps={session.steps} currentStepIndex={session.current_step_index} stepStartTemp={session.step_start_temp} />
            )}

            <div className="flex gap-1.5 pt-1">
              <Button 
                variant="outline" size="sm" className="flex-1 h-8 text-xs gap-1.5"
                style={{
                  background: 'hsl(var(--primary) / 0.08)',
                  borderColor: 'hsl(var(--primary) / 0.25)',
                }}
                onClick={handlePauseResume} disabled={actionLoading}
              >
                {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : session.status === 'paused' ? <><Play className="w-3.5 h-3.5" />Återuppta</> : <><Pause className="w-3.5 h-3.5" />Pausa</>}
              </Button>
              <Button 
                variant="outline" size="icon" className="h-8 w-8 shrink-0"
                style={{
                  background: 'hsl(var(--primary) / 0.05)',
                  borderColor: 'hsl(var(--primary) / 0.2)',
                }}
                onClick={() => setShowSkipConfirm(true)} disabled={skipLoading} 
                title={session.current_step_index + 1 >= (session.steps?.length || 0) ? 'Slutför profil' : 'Nästa steg'}
              >
                {skipLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <SkipForward className="w-3.5 h-3.5" />}
              </Button>
              <Button 
                variant="outline" size="icon" className="h-8 w-8 shrink-0"
                style={{
                  background: 'hsl(0 70% 50% / 0.06)',
                  borderColor: 'hsl(0 70% 50% / 0.2)',
                }}
                onClick={() => setShowCancelDialog(true)} disabled={actionLoading}
              >
                <Square className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {/* Dialogs */}
          <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Avbryt fermenteringsprofil?</AlertDialogTitle>
                <AlertDialogDescription>Den automatiska temperaturstyrningen kommer att stoppas.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Avbryt</AlertDialogCancel>
                <AlertDialogAction onClick={handleCancel}>Ja, stoppa profilen</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog open={showSkipConfirm} onOpenChange={setShowSkipConfirm}>
            <AlertDialogContent onClick={(e) => e.stopPropagation()}>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {session.current_step_index + 1 >= (session.steps?.length || 0) ? 'Slutför fermenteringsprofil?' : 'Hoppa till nästa steg?'}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {session.current_step_index + 1 >= (session.steps?.length || 0) ? 'Profilen kommer markeras som slutförd.' : `Steg ${session.current_step_index + 1} hoppas över och steg ${session.current_step_index + 2} startar.`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Avbryt</AlertDialogCancel>
                <AlertDialogAction onClick={() => { setShowSkipConfirm(false); handleSkipStep(); }}>
                  {session.current_step_index + 1 >= (session.steps?.length || 0) ? 'Slutför' : 'Hoppa över'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      );
    }

    return (
      <div onClick={isAuthenticated ? () => { setExpanded(true); onExpandChange?.(true); } : undefined} className={isAuthenticated ? 'cursor-pointer' : ''}>
        <FermentationSessionCompact
          profileName={session.profile?.name || ''}
          status={session.status}
          currentStepIndex={session.current_step_index}
          totalSteps={session.steps?.length || 0}
          currentStep={currentStep}
          stepStartedAt={session.step_started_at}
          stepStartTemp={session.step_start_temp}
          targetTemp={controllerData?.target_temp ?? null}
          profileStepTarget={profileStepTarget}
          currentTemp={controllerData?.current_temp ?? null}
          isRamping={isRamping}
          rampProgress={rampProgress}
          currentSg={currentSg}
          targetSg={stepTargetSg}
          sgComparison={stepSgComparison}
          originalGravity={originalGravity}
          sgData={sgData}
          isWaitingForGravityStable={isWaitingForGravityStable}
          onAcknowledge={session.status === 'completed' && isAuthenticated ? handleAcknowledge : undefined}
          onAcknowledgeStep={isWaitingForAcknowledgement && isAuthenticated ? handleAcknowledgeStep : undefined}
          acknowledgeLoading={acknowledgeLoading}
          activityScore={activityScore}
          fermentationPhase={fermentationPhase}
          attenuation={attenuation}
          controllerProfileTarget={controllerData?.profile_target_temp ?? null}
        />
      </div>
    );
  }

  // Full view
  return (
    <>
      <div 
        className="rounded-xl overflow-hidden backdrop-blur-md p-4 space-y-4"
        style={{
          background: 'linear-gradient(145deg, hsl(var(--primary) / 0.06) 0%, hsl(222 20% 12% / 0.85) 100%)',
          border: '1px solid hsl(var(--primary) / 0.15)',
          boxShadow: '0 8px 32px hsl(222 30% 3% / 0.5), inset 0 1px 0 hsl(0 0% 100% / 0.06)',
        }}
      >
        <FermentationSessionHeader
          profileName={session.profile?.name || ''}
          status={session.status}
          startedAt={session.started_at}
        />

        {currentStep && (
          <>
            <StepExecutionDisplay
              currentStep={currentStep}
              stepStartedAt={session.step_started_at}
              stepStartTemp={session.step_start_temp}
              currentTemp={controllerData?.current_temp ?? null}
              targetTemp={controllerData?.target_temp ?? null}
              profileTargetTemp={controllerData?.profile_target_temp ?? null}
              isRamping={isRamping}
              rampProgress={rampProgress}
              rampTriggeredAt={session.ramp_triggered_at}
              currentSg={currentSg}
              originalGravity={originalGravity}
              activityScore={activityScore}
              attenuation={attenuation}
            />
            <StepConditionsDisplay
              currentStep={currentStep}
              stepStartedAt={session.step_started_at}
              stepStartTemp={session.step_start_temp}
              currentTemp={controllerData?.current_temp ?? null}
              profileTargetTemp={controllerData?.profile_target_temp ?? null}
              currentSg={currentSg}
              originalGravity={originalGravity}
              activityScore={activityScore}
              attenuation={attenuation}
              sgData={sgData}
            />
          </>
        )}

        {session.steps && session.steps.length > 0 && (
          <StepsOverview steps={session.steps} currentStepIndex={session.current_step_index} stepStartTemp={session.step_start_temp} />
        )}

        {isAuthenticated && (
          <div className="flex gap-1.5 pt-1">
            <Button 
              variant="outline" size="sm" className="flex-1 h-8 text-xs gap-1.5"
              style={{
                background: 'hsl(var(--primary) / 0.08)',
                borderColor: 'hsl(var(--primary) / 0.25)',
              }}
              onClick={handlePauseResume} disabled={actionLoading}
            >
              {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : session.status === 'paused' ? <><Play className="w-3.5 h-3.5" />Återuppta</> : <><Pause className="w-3.5 h-3.5" />Pausa</>}
            </Button>
            <Button 
              variant="outline" size="icon" className="h-8 w-8 shrink-0"
              style={{
                background: 'hsl(var(--primary) / 0.05)',
                borderColor: 'hsl(var(--primary) / 0.2)',
              }}
              onClick={() => setShowSkipConfirm(true)} disabled={skipLoading}
              title={session.current_step_index + 1 >= (session.steps?.length || 0) ? 'Slutför profil' : 'Nästa steg'}
            >
              {skipLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <SkipForward className="w-3.5 h-3.5" />}
            </Button>
            <Button 
              variant="outline" size="icon" className="h-8 w-8 shrink-0"
              style={{
                background: 'hsl(0 70% 50% / 0.06)',
                borderColor: 'hsl(0 70% 50% / 0.2)',
              }}
              onClick={() => setShowCancelDialog(true)} disabled={actionLoading}
            >
              <Square className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>

      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Avbryt fermenteringsprofil?</AlertDialogTitle>
            <AlertDialogDescription>Den automatiska temperaturstyrningen kommer att stoppas. Du kan starta en ny profil efteråt.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel}>Ja, stoppa profilen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showSkipConfirm} onOpenChange={setShowSkipConfirm}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {session.current_step_index + 1 >= (session.steps?.length || 0) ? 'Slutför fermenteringsprofil?' : 'Hoppa till nästa steg?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {session.current_step_index + 1 >= (session.steps?.length || 0) ? 'Profilen kommer markeras som slutförd.' : `Steg ${session.current_step_index + 1} hoppas över och steg ${session.current_step_index + 2} startar.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setShowSkipConfirm(false); handleSkipStep(); }}>
              {session.current_step_index + 1 >= (session.steps?.length || 0) ? 'Slutför' : 'Hoppa över'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Sub-component for steps overview
interface StepsOverviewProps {
  steps: FermentationProfileStep[];
  currentStepIndex: number;
  stepStartTemp?: number | null;
}

function StepsOverview({ steps, currentStepIndex, stepStartTemp }: StepsOverviewProps) {
  const getStepIcon = (step: FermentationProfileStep, index: number) => {
    const isUp = step.step_type === 'ramp' && step.target_temp != null && stepStartTemp != null && index === currentStepIndex && step.target_temp > stepStartTemp;
    switch (step.step_type) {
      case 'ramp': return isUp ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />;
      case 'hold': return <Thermometer className="w-2.5 h-2.5" />;
      case 'wait_for_gravity_stable': case 'wait_for_sg': case 'gradual_ramp': case 'diacetyl_rest': return <Activity className="w-2.5 h-2.5" />;
      default: return <Clock className="w-2.5 h-2.5" />;
    }
  };

  const getStepTemp = (step: FermentationProfileStep, index: number) => {
    if (step.step_type === 'ramp' && step.target_temp != null) {
      if (index === currentStepIndex && stepStartTemp != null) return `${Math.round(stepStartTemp)}→${step.target_temp}°`;
      return `→${step.target_temp}°`;
    }
    if (step.step_type === 'gradual_ramp' || step.step_type === 'diacetyl_rest') {
      return `+${step.temp_increase ?? 3}°`;
    }
    if (step.target_temp != null) return `${step.target_temp}°`;
    return null;
  };

  return (
    <div className="flex items-center gap-0.5 overflow-x-auto py-1">
      {steps.map((step, index) => {
        const isDone = index < currentStepIndex;
        const isCurrent = index === currentStepIndex;
        const tempDisplay = getStepTemp(step, index);
        
        return (
          <div key={step.id} className="flex items-center">
            {index > 0 && (
              <div 
                className="w-2 h-px mx-0.5"
                style={{ background: isDone ? 'hsl(var(--primary) / 0.5)' : 'hsl(0 0% 100% / 0.1)' }}
              />
            )}
            <div 
              className="flex items-center gap-1 rounded-md px-1.5 py-1 transition-all"
              style={{
                background: isCurrent 
                  ? 'hsl(var(--primary) / 0.2)' 
                  : isDone 
                  ? 'hsl(var(--primary) / 0.08)' 
                  : 'hsl(0 0% 100% / 0.04)',
                border: `1px solid ${isCurrent ? 'hsl(var(--primary) / 0.4)' : isDone ? 'hsl(var(--primary) / 0.15)' : 'hsl(0 0% 100% / 0.06)'}`,
                color: isCurrent 
                  ? 'hsl(var(--primary))' 
                  : isDone 
                  ? 'hsl(var(--primary) / 0.7)' 
                  : 'hsl(var(--muted-foreground))',
                boxShadow: isCurrent ? '0 0 8px hsl(var(--primary) / 0.15)' : undefined,
              }}
            >
              {/* Step number badge */}
              <span 
                className="flex items-center justify-center rounded text-[9px] font-bold leading-none shrink-0"
                style={{
                  width: '16px',
                  height: '16px',
                  background: isCurrent 
                    ? 'hsl(var(--primary) / 0.3)' 
                    : isDone 
                    ? 'hsl(var(--primary) / 0.15)' 
                    : 'hsl(0 0% 100% / 0.08)',
                  border: `1px solid ${isCurrent ? 'hsl(var(--primary) / 0.5)' : 'transparent'}`,
                }}
              >
                {index + 1}
              </span>
              {/* Icon + temp info */}
              <span className="flex items-center gap-0.5 text-[10px] font-medium opacity-80 whitespace-nowrap">
                {getStepIcon(step, index)}
                {tempDisplay && <span>{tempDisplay}</span>}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
