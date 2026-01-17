import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { 
  FermentationSession, 
  FermentationProfile, 
  FermentationProfileStep,
} from "@/types/fermentation";
import { Play, Pause, Square, Loader2 } from "lucide-react";
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
import { useRealtimeSubscription } from "@/hooks/use-realtime-subscription";

interface ActiveFermentationSessionProps {
  controllerId?: string;
  brewId?: string;
  compact?: boolean;
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
  compact = false 
}: ActiveFermentationSessionProps) {
  const [session, setSession] = useState<SessionWithDetails | null>(null);
  const [controllerData, setControllerData] = useState<ControllerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const { toast } = useToast();

  // Auth check
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAuthenticated(!!session);
    });
  }, []);

  // Load session data
  const loadSession = useCallback(async () => {
    if (!controllerId && !brewId) return;
    
    setLoading(true);
    
    let query = supabase
      .from('fermentation_sessions')
      .select('*')
      .in('status', ['running', 'paused']);
    
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
  }, [controllerId, brewId]);

  // Initial load
  useEffect(() => {
    loadSession();
  }, [loadSession]);

  // Realtime subscription for session updates
  useRealtimeSubscription({
    table: 'fermentation_sessions',
    filter: controllerId 
      ? `controller_id=eq.${controllerId}` 
      : brewId 
        ? `brew_id=eq.${brewId}` 
        : undefined,
    onPayload: loadSession,
    enabled: !!(controllerId || brewId),
  });

  // Realtime subscription for controller temp updates
  useRealtimeSubscription({
    table: 'rapt_temp_controllers',
    filter: session?.controller_id ? `controller_id=eq.${session.controller_id}` : undefined,
    event: 'UPDATE',
    onPayload: (payload: any) => {
      if (payload.new) {
        setControllerData({
          current_temp: payload.new.current_temp,
          target_temp: payload.new.target_temp,
          name: payload.new.name
        });
      }
    },
    enabled: !!session?.controller_id,
  });

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

  // Calculate progress values
  const calculateProgress = useCallback(() => {
    if (!session?.steps?.length) return 0;
    return ((session.current_step_index) / session.steps.length) * 100;
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

  if (loading || !session) {
    return null;
  }

  const currentStep = session.steps?.[session.current_step_index];
  const progress = calculateProgress();
  const stepProgress = calculateStepProgress();
  const rampProgress = getRampProgress();
  const isRamping = rampProgress !== null && rampProgress < 1;

  // Compact view uses the dedicated component
  if (compact) {
    return (
      <FermentationSessionCompact
        profileName={session.profile?.name || ''}
        status={session.status}
        currentStepIndex={session.current_step_index}
        totalSteps={session.steps?.length || 0}
        currentStep={currentStep}
        stepStartedAt={session.step_started_at}
        targetTemp={controllerData?.target_temp ?? null}
        isRamping={isRamping}
        rampProgress={rampProgress}
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
            targetTemp={controllerData?.target_temp ?? null}
            currentTemp={controllerData?.current_temp ?? null}
            isRamping={isRamping}
            rampProgress={rampProgress}
            stepProgress={stepProgress}
          />
        )}

        {/* Steps Overview */}
        {session.steps && session.steps.length > 0 && (
          <StepsOverview 
            steps={session.steps} 
            currentStepIndex={session.current_step_index} 
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
    </>
  );
}

// Sub-component for steps overview
interface StepsOverviewProps {
  steps: FermentationProfileStep[];
  currentStepIndex: number;
}

function StepsOverview({ steps, currentStepIndex }: StepsOverviewProps) {
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

  const getStepTemp = (step: FermentationProfileStep) => {
    if (step.target_temp != null) {
      return `${step.target_temp}°`;
    }
    return null;
  };

  return (
    <div className="flex flex-wrap gap-1">
      {steps.map((step, index) => {
        const temp = getStepTemp(step);
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
            <span>{index + 1}{temp && ` (${temp})`}</span>
          </div>
        );
      })}
    </div>
  );
}
