import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  FermentationSession, 
  FermentationProfile, 
  FermentationProfileStep,
} from "@/types/fermentation";
import { FermentationSessionData } from "@/types/brew";
import { Play, Pause, Square, Loader2, SkipForward } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FermentationSessionCompact } from "./FermentationSessionCompact";
import { FermentationSessionHeader } from "./FermentationSessionHeader";
import { FermentationStepDisplay } from "./FermentationStepDisplay";
import { useDeferredRender } from "@/hooks/use-deferred-render";
import { useTvMode } from "@/contexts/TvModeContext";

interface ActiveFermentationSessionProps {
  controllerId?: string;
  brewId?: string;
  compact?: boolean;
  preloadedSession?: FermentationSessionData | null;
  isAuthenticated?: boolean;
  currentSg?: number | null;
  originalGravity?: number | null;
  sgData?: Array<{ date: string; value: number; temp: number }>;
}

interface SessionWithDetails extends FermentationSession {
  profile?: FermentationProfile;
  steps?: FermentationProfileStep[];
}

interface ControllerData {
  current_temp: number | null;
  target_temp: number | null;
  name: string;
}

export function ActiveFermentationSession({ 
  controllerId, 
  brewId,
  compact = false,
  preloadedSession,
  isAuthenticated: isAuthenticatedProp,
  currentSg,
  originalGravity,
  sgData,
}: ActiveFermentationSessionProps) {
  const [session, setSession] = useState<SessionWithDetails | null>(null);
  const [controllerData, setControllerData] = useState<ControllerData | null>(null);
  const [loading, setLoading] = useState(!preloadedSession);
  const [actionLoading, setActionLoading] = useState(false);
  const [skipLoading, setSkipLoading] = useState(false);
  const [acknowledgeLoading, setAcknowledgeLoading] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const [isAuthenticatedLocal, setIsAuthenticatedLocal] = useState(false);
  const [, setTick] = useState(0); // Force re-render for time-based progress
  const { toast } = useToast();
  const { isTvMode } = useTvMode();
  
  // Defer rendering to prevent blocking main thread during page updates
  const shouldRender = useDeferredRender();
  
  // Use prop if provided, otherwise fetch (for non-compact views)
  const isAuthenticated = isAuthenticatedProp ?? isAuthenticatedLocal;

  // Auth check - only if not provided via props
  useEffect(() => {
    if (isAuthenticatedProp === undefined) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        setIsAuthenticatedLocal(!!session);
      });
    }
  }, [isAuthenticatedProp]);

  // Update progress every minute using setInterval
  // (setInterval works during TV casting, unlike requestAnimationFrame)
  // In TV mode, use longer interval (30s) to reduce CPU load
  const lastMinuteRef = useRef(-1);
  
  useEffect(() => {
    const checkInterval = isTvMode ? 30000 : 5000; // 30s in TV mode, 5s otherwise
    
    const intervalId = setInterval(() => {
      const currentMinute = Math.floor(Date.now() / 60000);
      
      if (currentMinute !== lastMinuteRef.current) {
        lastMinuteRef.current = currentMinute;
        setTick(t => t + 1);
      }
    }, checkInterval);
    
    return () => clearInterval(intervalId);
  }, [isTvMode]);

  // Use preloaded session if available (for compact view optimization)
  useEffect(() => {
    if (preloadedSession && compact) {
      // Convert preloaded session to the expected format
      const steps = preloadedSession.steps.map(s => ({
        id: s.id,
        profile_id: preloadedSession.profile_id,
        step_type: s.step_type,
        step_order: s.step_order,
        target_temp: s.target_temp,
        duration_hours: s.duration_hours,
        ramp_type: s.ramp_type,
        gravity_stable_days: s.gravity_stable_days,
        target_sg: s.target_sg,
        sg_comparison: s.sg_comparison,
        notes: null,
        gravity_threshold: null,
        created_at: '',
        updated_at: '',
      })) as FermentationProfileStep[];

      setSession({
        id: preloadedSession.id,
        profile_id: preloadedSession.profile_id,
        brew_id: brewId || null,
        controller_id: preloadedSession.controller_id,
        status: preloadedSession.status as 'running' | 'paused' | 'completed' | 'cancelled',
        current_step_index: preloadedSession.current_step_index,
        step_started_at: preloadedSession.step_started_at,
        started_at: preloadedSession.started_at,
        completed_at: null,
        created_at: '',
        updated_at: '',
        step_start_temp: preloadedSession.step_start_temp,
        profile: { 
          id: preloadedSession.profile_id, 
          name: preloadedSession.profile_name,
          description: null,
          created_at: '',
          updated_at: '',
        },
        steps,
      });
      
      setControllerData({
        current_temp: preloadedSession.controller_current_temp,
        target_temp: preloadedSession.controller_target_temp,
        name: '',
      });
      
      setLoading(false);
    }
  }, [preloadedSession, compact, brewId]);

  // Keep controller data fresh via realtime in compact/preloaded mode
  // Only active during ramp steps (where target_temp changes continuously) to save resources
  const currentStepType = preloadedSession?.steps?.[preloadedSession.current_step_index]?.step_type;
  const isRampStep = currentStepType === 'ramp';

  useEffect(() => {
    if (!preloadedSession || !compact || !isRampStep) return;
    const cId = preloadedSession.controller_id;
    if (!cId) return;

    const channel = supabase
      .channel(`ferm-ctrl-${cId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rapt_temp_controllers',
          filter: `controller_id=eq.${cId}`,
        },
        (payload) => {
          const newData = payload.new as any;
          setControllerData(prev => ({
            ...prev,
            current_temp: newData.current_temp ?? prev?.current_temp ?? null,
            target_temp: newData.target_temp ?? prev?.target_temp ?? null,
            name: prev?.name ?? '',
          }));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [preloadedSession?.controller_id, compact, isRampStep]);

  // Load session data (only if not using preloaded data)
  const loadSession = useCallback(async () => {
    // Skip loading if using preloaded session in compact mode
    if (preloadedSession && compact) return;
    if (!controllerId && !brewId) return;
    
    setLoading(true);
    
    let query = supabase
      .from('fermentation_sessions')
      .select('*')
      .in('status', ['running', 'paused', 'completed']);
    
    if (controllerId) {
      query = query.eq('controller_id', controllerId);
    } else if (brewId) {
      query = query.eq('brew_id', brewId);
    }
    
    const { data: sessions } = await query.limit(1).maybeSingle();
    
    if (sessions) {
      const [profileRes, stepsRes, controllerRes] = await Promise.all([
        supabase
          .from('fermentation_profiles')
          .select('*')
          .eq('id', sessions.profile_id)
          .single(),
        supabase
          .from('fermentation_profile_steps')
          .select('*')
          .eq('profile_id', sessions.profile_id)
          .order('step_order'),
        supabase
          .from('rapt_temp_controllers')
          .select('current_temp, target_temp, name')
          .eq('controller_id', sessions.controller_id)
          .single()
      ]);

      setSession({
        ...sessions as FermentationSession,
        profile: profileRes.data as FermentationProfile | undefined,
        steps: stepsRes.data as FermentationProfileStep[] | undefined
      });
      
      if (controllerRes.data) {
        setControllerData(controllerRes.data as ControllerData);
      }
    } else {
      setSession(null);
      setControllerData(null);
    }
    
    setLoading(false);
  }, [controllerId, brewId, preloadedSession, compact]);

  // Initial load (only if not using preloaded data)
  useEffect(() => {
    if (!preloadedSession || !compact) {
      loadSession();
    }
  }, [loadSession, preloadedSession, compact]);

  // Realtime subscriptions removed - data is updated via consolidated
  // 'data-updates' channel in use-brew-data.ts which triggers preloadedSession updates

  const handlePauseResume = useCallback(async () => {
    if (!session) return;
    
    setActionLoading(true);
    const newStatus = session.status === 'running' ? 'paused' : 'running';
    
    const { error } = await supabase
      .from('fermentation_sessions')
      .update({ status: newStatus })
      .eq('id', session.id);

    if (error) {
      toast({ title: "Fel", description: "Kunde inte uppdatera session", variant: "destructive" });
    } else {
      await supabase.from('fermentation_step_log').insert({
        session_id: session.id,
        step_index: session.current_step_index,
        action: newStatus === 'paused' ? 'paused' : 'resumed',
        details: {}
      });
      
      toast({ 
        title: newStatus === 'paused' ? "Pausad" : "Återupptagen",
        description: newStatus === 'paused' 
          ? "Fermenteringsprofilen har pausats" 
          : "Fermenteringsprofilen fortsätter"
      });
      loadSession();
    }
    
    setActionLoading(false);
  }, [session, toast, loadSession]);

  const handleCancel = useCallback(async () => {
    if (!session) return;
    
    setActionLoading(true);
    
    const { error } = await supabase
      .from('fermentation_sessions')
      .update({ status: 'cancelled', completed_at: new Date().toISOString() })
      .eq('id', session.id);

    if (error) {
      toast({ title: "Fel", description: "Kunde inte avbryta session", variant: "destructive" });
    } else {
      await supabase.from('fermentation_step_log').insert({
        session_id: session.id,
        step_index: session.current_step_index,
        action: 'cancelled',
        details: {}
      });
      
      toast({ title: "Avbruten", description: "Fermenteringsprofilen har avbrutits" });
      setSession(null);
    }
    
    setActionLoading(false);
    setShowCancelDialog(false);
  }, [session, toast]);

  // Skip to next step manually
  const handleSkipStep = useCallback(async () => {
    if (!session || !session.steps) return;
    
    setSkipLoading(true);
    const nextStepIndex = session.current_step_index + 1;
    
    if (nextStepIndex >= session.steps.length) {
      // Complete the profile
      const { error } = await supabase
        .from('fermentation_sessions')
        .update({ 
          status: 'completed', 
          completed_at: new Date().toISOString() 
        })
        .eq('id', session.id);

      if (error) {
        toast({ title: "Fel", description: "Kunde inte slutföra profilen", variant: "destructive" });
      } else {
        await supabase.from('fermentation_step_log').insert({
          session_id: session.id,
          step_index: session.current_step_index,
          action: 'skipped',
          details: { reason: 'manual_skip', message: 'Manuellt hoppat till nästa steg - profil slutförd' }
        });
        
        toast({ 
          title: "Profil slutförd", 
          description: "Fermenteringsprofilen har slutförts manuellt" 
        });
        setSession(null);
      }
    } else {
      // Move to next step
      const { error } = await supabase
        .from('fermentation_sessions')
        .update({ 
          current_step_index: nextStepIndex,
          step_started_at: new Date().toISOString(),
          step_start_temp: controllerData?.target_temp ?? null
        })
        .eq('id', session.id);

      if (error) {
        toast({ title: "Fel", description: "Kunde inte gå vidare till nästa steg", variant: "destructive" });
      } else {
        await supabase.from('fermentation_step_log').insert({
          session_id: session.id,
          step_index: session.current_step_index,
          action: 'skipped',
          details: { reason: 'manual_skip', message: 'Manuellt hoppat till nästa steg' }
        });
        
        toast({ 
          title: "Steg hoppat", 
          description: `Gått vidare till steg ${nextStepIndex + 1}` 
        });
        loadSession();
      }
    }
    
    setSkipLoading(false);
  }, [session, controllerData, toast, loadSession]);

  // Acknowledge completed session (deletes the session record)
  const handleAcknowledge = useCallback(async () => {
    if (!session) return;
    
    setAcknowledgeLoading(true);
    
    const { error } = await supabase
      .from('fermentation_sessions')
      .delete()
      .eq('id', session.id);

    if (error) {
      toast({ title: "Fel", description: "Kunde inte kvittera sessionen", variant: "destructive" });
    } else {
      toast({ 
        title: "Kvitterad", 
        description: "Fermenteringsprofilen har kvitterats" 
      });
      setSession(null);
    }
    
    setAcknowledgeLoading(false);
  }, [session, toast]);

  const calculateProgress = useCallback(() => {
    if (!session?.steps?.length) return 0;
    const totalSteps = session.steps.length;
    const completedSteps = session.current_step_index;
    
    // Calculate progress within current step
    const currentStep = session.steps[session.current_step_index];
    let currentStepProgress = 0;
    
    if (currentStep && (currentStep.step_type === 'hold' || (currentStep.step_type === 'ramp' && currentStep.ramp_type === 'linear'))) {
      if (currentStep.duration_hours) {
        const stepStarted = new Date(session.step_started_at);
        const elapsed = (Date.now() - stepStarted.getTime()) / (1000 * 60 * 60);
        currentStepProgress = Math.min(elapsed / currentStep.duration_hours, 1);
      }
    }
    
    // Overall progress = completed steps + current step progress (weighted)
    return ((completedSteps + currentStepProgress) / totalSteps) * 100;
  }, [session]);

  const calculateStepProgress = useCallback(() => {
    if (!session?.steps) return 0;
    const currentStep = session.steps[session.current_step_index];
    if (!currentStep) return 100;

    if (currentStep.step_type === 'hold' || (currentStep.step_type === 'ramp' && currentStep.ramp_type === 'linear')) {
      if (!currentStep.duration_hours) return 0;
      const stepStarted = new Date(session.step_started_at);
      const elapsed = (Date.now() - stepStarted.getTime()) / (1000 * 60 * 60);
      return Math.min((elapsed / currentStep.duration_hours) * 100, 100);
    }

    return 0;
  }, [session]);

  const getRampProgress = useCallback(() => {
    if (!session?.steps) return null;
    const currentStep = session.steps[session.current_step_index];
    if (!currentStep || currentStep.step_type !== 'ramp' || currentStep.ramp_type !== 'linear') {
      return null;
    }
    if (!currentStep.duration_hours) return null;
    const stepStarted = new Date(session.step_started_at);
    const elapsed = (Date.now() - stepStarted.getTime()) / (1000 * 60 * 60);
    return Math.min(Math.max(elapsed / currentStep.duration_hours, 0), 1);
  }, [session]);

  // Show skeleton while deferring render to prevent blocking main thread
  if (!shouldRender && compact) {
    return (
      <div className="rounded-lg border bg-card/50 p-3">
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (loading || !session) {
    return null;
  }

  const currentStep = session.steps?.[session.current_step_index];
  const progress = calculateProgress();
  const stepProgress = calculateStepProgress();
  const rampProgress = getRampProgress();
  const isRamping = rampProgress !== null && rampProgress < 1;

  // Detect if we're in a "waiting" state that allows manual skip
  const isWaitingForTemp = (() => {
    if (!currentStep || currentStep.step_type !== 'ramp' || !currentStep.duration_hours) {
      return false;
    }
    const stepStarted = new Date(session.step_started_at);
    const elapsedHours = (Date.now() - stepStarted.getTime()) / (1000 * 60 * 60);
    const timeComplete = elapsedHours >= currentStep.duration_hours;
    const tempReached = currentStep.target_temp != null && controllerData?.current_temp != null &&
      Math.abs(controllerData.current_temp - currentStep.target_temp) <= 0.5;
    return timeComplete && !tempReached;
  })();

  // Detect if we're in a gravity stability check step (allows manual skip)
  const isWaitingForGravityStable = currentStep?.step_type === 'wait_for_gravity_stable';

  // Compact view uses the dedicated component
  if (compact) {
    // Get SG target from current step if it's SG-conditioned
    const stepTargetSg = currentStep?.target_sg ?? null;
    const stepSgComparison = currentStep?.sg_comparison ?? null;
    
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
        acknowledgeLoading={acknowledgeLoading}
      />
    );
  }

  // Full view
  return (
    <>
      <div className="rounded-lg border bg-card p-3 space-y-3">
        {/* Header */}
        <FermentationSessionHeader
          profileName={session.profile?.name || ''}
          status={session.status}
          startedAt={session.started_at}
        />

        {/* Overall Progress */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Övergripande progress</span>
            <span className="font-medium">{session.current_step_index + 1} av {session.steps?.length || 0} steg</span>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>

        {/* Current Step */}
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

        {/* Steps Overview */}
        {session.steps && session.steps.length > 0 && (
          <StepsOverview 
            steps={session.steps} 
            currentStepIndex={session.current_step_index}
            stepStartTemp={session.step_start_temp}
          />
        )}

        {/* Actions */}
        {isAuthenticated && (
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={handlePauseResume}
              disabled={actionLoading}
            >
              {actionLoading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : session.status === 'paused' ? (
                <>
                  <Play className="w-3 h-3 mr-1" />
                  Återuppta
                </>
              ) : (
                <>
                  <Pause className="w-3 h-3 mr-1" />
                  Pausa
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSkipConfirm(true)}
              disabled={skipLoading}
              title={session.current_step_index + 1 >= (session.steps?.length || 0) ? 'Slutför profil' : 'Nästa steg'}
            >
              {skipLoading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <SkipForward className="w-3 h-3" />
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCancelDialog(true)}
              disabled={actionLoading}
            >
              <Square className="w-3 h-3" />
            </Button>
          </div>
        )}
      </div>

      {/* Cancel Confirmation */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Avbryt fermenteringsprofil?</AlertDialogTitle>
            <AlertDialogDescription>
              Den automatiska temperaturstyrningen kommer att stoppas. Du kan starta en ny profil efteråt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel}>Ja, stoppa profilen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Skip Step Confirmation */}
      <AlertDialog open={showSkipConfirm} onOpenChange={setShowSkipConfirm}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {session.current_step_index + 1 >= (session.steps?.length || 0)
                ? 'Slutför fermenteringsprofil?'
                : 'Hoppa till nästa steg?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {session.current_step_index + 1 >= (session.steps?.length || 0)
                ? 'Profilen kommer markeras som slutförd.'
                : `Steg ${session.current_step_index + 1} hoppas över och steg ${session.current_step_index + 2} startar.`}
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
      default: return '⏱';
    }
  };

  const getStepTempDisplay = (step: FermentationProfileStep, index: number) => {
    // For ramp steps that are current, show start → target
    if (step.step_type === 'ramp' && step.target_temp != null) {
      if (index === currentStepIndex && stepStartTemp != null) {
        return `${Math.round(stepStartTemp)}→${step.target_temp}°`;
      }
      return `→${step.target_temp}°`;
    }
    // For other steps with target temp
    if (step.target_temp != null) {
      return `${step.target_temp}°`;
    }
    return null;
  };

  return (
    <div className="flex flex-wrap gap-1">
      {steps.map((step, index) => {
        const tempDisplay = getStepTempDisplay(step, index);
        return (
          <div
            key={step.id}
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border ${
              index < currentStepIndex
                ? 'bg-primary/20 border-primary/30 text-primary'
                : index === currentStepIndex
                ? 'bg-primary border-primary text-primary-foreground'
                : 'bg-muted border-border text-muted-foreground'
            }`}
          >
            <span className="text-[10px]">{getStepIcon(step.step_type)}</span>
            <span>{index + 1}{tempDisplay && ` (${tempDisplay})`}</span>
          </div>
        );
      })}
    </div>
  );
}
