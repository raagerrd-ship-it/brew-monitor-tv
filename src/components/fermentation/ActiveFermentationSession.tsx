import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { FermentationProfileStep } from "@/types/fermentation";
import { FermentationSessionData } from "@/types/brew";
import { Play, Pause, Square, Loader2, SkipForward } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FermentationSessionCompact } from "./FermentationSessionCompact";
import { FermentationSessionHeader } from "./FermentationSessionHeader";
import { FermentationStepDisplay } from "./FermentationStepDisplay";
import { useDeferredRender } from "@/hooks/use-deferred-render";
import { useActiveFermentationSession } from "@/hooks/use-active-fermentation-session";

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
}

export function ActiveFermentationSession({
  controllerId, brewId, compact = false, preloadedSession,
  isAuthenticated: isAuthenticatedProp, currentSg, originalGravity,
  sgData, activityScore, fermentationPhase, attenuation,
}: ActiveFermentationSessionProps) {
  const shouldRender = useDeferredRender();

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

    return (
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
    );
  }

  // Full view
  return (
    <>
      <div className="rounded-lg border bg-card p-3 space-y-3">
        <FermentationSessionHeader
          profileName={session.profile?.name || ''}
          status={session.status}
          startedAt={session.started_at}
        />

        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Övergripande progress</span>
            <span className="font-medium">{session.current_step_index + 1} av {session.steps?.length || 0} steg</span>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>

        {currentStep && (
          <FermentationStepDisplay
            currentStep={currentStep}
            steps={session.steps || []}
            currentStepIndex={session.current_step_index}
            stepStartedAt={session.step_started_at}
            stepStartTemp={session.step_start_temp}
            targetTemp={controllerData?.target_temp ?? null}
            currentTemp={controllerData?.current_temp ?? null}
            isRamping={isRamping}
            rampProgress={rampProgress}
            stepProgress={stepProgress}
            currentSg={currentSg}
            targetSg={currentStep.target_sg ?? null}
            sgComparison={currentStep.sg_comparison ?? null}
            originalGravity={originalGravity}
          />
        )}

        {session.steps && session.steps.length > 0 && (
          <StepsOverview steps={session.steps} currentStepIndex={session.current_step_index} stepStartTemp={session.step_start_temp} />
        )}

        {isAuthenticated && (
          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" className="flex-1" onClick={handlePauseResume} disabled={actionLoading}>
              {actionLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : session.status === 'paused' ? <><Play className="w-3 h-3 mr-1" />Återuppta</> : <><Pause className="w-3 h-3 mr-1" />Pausa</>}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowSkipConfirm(true)} disabled={skipLoading} title={session.current_step_index + 1 >= (session.steps?.length || 0) ? 'Slutför profil' : 'Nästa steg'}>
              {skipLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <SkipForward className="w-3 h-3" />}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowCancelDialog(true)} disabled={actionLoading}>
              <Square className="w-3 h-3" />
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
  const getStepIcon = (stepType: string) => {
    switch (stepType) {
      case 'ramp': return '↘';
      case 'hold': return '🌡';
      case 'wait_for_temp': return '⏳';
      case 'wait_for_gravity_stable': return '📊';
      case 'wait_for_sg': return '📈';
      case 'wait_for_acknowledgement': return '✋';
      default: return '⏱';
    }
  };

  const getStepTempDisplay = (step: FermentationProfileStep, index: number) => {
    if (step.step_type === 'ramp' && step.target_temp != null) {
      if (index === currentStepIndex && stepStartTemp != null) return `${Math.round(stepStartTemp)}→${step.target_temp}°`;
      return `→${step.target_temp}°`;
    }
    if (step.target_temp != null) return `${step.target_temp}°`;
    return null;
  };

  return (
    <div className="flex flex-wrap gap-1">
      {steps.map((step, index) => {
        const tempDisplay = getStepTempDisplay(step, index);
        return (
          <div key={step.id} className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border ${
            index < currentStepIndex ? 'bg-primary/20 border-primary/30 text-primary'
            : index === currentStepIndex ? 'bg-primary border-primary text-primary-foreground'
            : 'bg-muted border-border text-muted-foreground'
          }`}>
            <span className="text-[10px]">{getStepIcon(step.step_type)}</span>
            <span>{index + 1}{tempDisplay && ` (${tempDisplay})`}</span>
          </div>
        );
      })}
    </div>
  );
}
