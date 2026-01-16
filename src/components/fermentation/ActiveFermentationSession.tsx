import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { 
  FermentationSession, 
  FermentationProfile, 
  FermentationProfileStep,
  STEP_TYPE_LABELS,
  SESSION_STATUS_LABELS
} from "@/types/fermentation";
import { 
  Play, 
  Pause, 
  Square, 
  Thermometer, 
  Clock, 
  Activity, 
  ArrowDown,
  ChevronRight,
  Loader2
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAuthenticated(!!session);
    });
  }, []);

  useEffect(() => {
    if (controllerId || brewId) {
      loadSession();
      
      // Subscribe to realtime updates for sessions
      const sessionChannel = supabase
        .channel(`fermentation-session-${controllerId || brewId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'fermentation_sessions',
            filter: controllerId 
              ? `controller_id=eq.${controllerId}` 
              : `brew_id=eq.${brewId}`
          },
          () => {
            loadSession();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(sessionChannel);
      };
    }
  }, [controllerId, brewId]);

  // Subscribe to controller temp updates
  useEffect(() => {
    if (session?.controller_id) {
      const controllerChannel = supabase
        .channel(`controller-temp-${session.controller_id}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'rapt_temp_controllers',
            filter: `controller_id=eq.${session.controller_id}`
          },
          (payload) => {
            if (payload.new) {
              setControllerData({
                current_temp: (payload.new as any).current_temp,
                target_temp: (payload.new as any).target_temp,
                name: (payload.new as any).name
              });
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(controllerChannel);
      };
    }
  }, [session?.controller_id]);

  const loadSession = async () => {
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
      // Load profile, steps, and controller data in parallel
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
  };

  const handlePauseResume = async () => {
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
      // Log the action
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
  };

  const handleCancel = async () => {
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
  };

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

  const getStepDescription = (step: FermentationProfileStep) => {
    switch (step.step_type) {
      case 'hold':
        return `${step.target_temp}°C i ${step.duration_hours}h`;
      case 'ramp':
        return `${step.ramp_type === 'immediate' ? '→' : '↘'} ${step.target_temp}°C`;
      case 'wait_for_temp':
        return `Vänta tills ${step.target_temp}°C`;
      case 'wait_for_gravity_stable':
        return `Stabil SG ${step.gravity_stable_days}d`;
      case 'wait_for_sg':
        return `SG ${step.sg_comparison === 'at_or_below' ? '≤' : '≥'} ${step.target_sg}`;
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

  const getNextStepCondition = (step: FermentationProfileStep, stepStartedAt: string) => {
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

  const calculateProgress = () => {
    if (!session || !session.steps || session.steps.length === 0) return 0;
    return ((session.current_step_index) / session.steps.length) * 100;
  };

  const calculateStepProgress = () => {
    if (!session || !session.steps) return 0;
    const currentStep = session.steps[session.current_step_index];
    if (!currentStep) return 100;

    // For time-based steps, calculate based on elapsed time
    if (currentStep.step_type === 'hold' || (currentStep.step_type === 'ramp' && currentStep.ramp_type === 'linear')) {
      if (!currentStep.duration_hours) return 0;
      const stepStarted = new Date(session.step_started_at);
      const elapsed = (Date.now() - stepStarted.getTime()) / (1000 * 60 * 60);
      return Math.min((elapsed / currentStep.duration_hours) * 100, 100);
    }

    // For condition-based steps, we can't calculate progress
    return 0;
  };

  if (loading) {
    return null;
  }

  if (!session) {
    return null;
  }

  const currentStep = session.steps?.[session.current_step_index];
  const progress = calculateProgress();
  const stepProgress = calculateStepProgress();

  // Calculate ramp progress for gradient background
  const getRampProgress = () => {
    if (!currentStep || currentStep.step_type !== 'ramp' || currentStep.ramp_type !== 'linear') {
      return null;
    }
    if (!currentStep.duration_hours) return null;
    const stepStarted = new Date(session.step_started_at);
    const elapsed = (Date.now() - stepStarted.getTime()) / (1000 * 60 * 60);
    return Math.min(Math.max(elapsed / currentStep.duration_hours, 0), 1);
  };

  const rampProgress = getRampProgress();
  const isRamping = rampProgress !== null && rampProgress < 1;

  if (compact) {
    return (
      <div 
        className="relative flex items-center gap-2 p-2 rounded-md border overflow-hidden"
        style={{
          borderColor: isRamping ? 'hsl(var(--primary) / 0.3)' : 'hsl(var(--primary) / 0.2)',
        }}
      >
        {/* Gradient background for ramp progress */}
        {isRamping && (
          <div 
            className="absolute inset-0 pointer-events-none"
            style={{
              background: `linear-gradient(90deg, 
                hsl(var(--primary) / 0.15) 0%, 
                hsl(38 92% 50% / 0.2) ${rampProgress * 100}%, 
                hsl(var(--primary) / 0.05) ${rampProgress * 100}%, 
                hsl(var(--primary) / 0.05) 100%)`,
            }}
          />
        )}
        {!isRamping && (
          <div className="absolute inset-0 bg-primary/10 pointer-events-none" />
        )}
        
        {/* Content */}
        <div className="relative z-10 flex items-center gap-2 w-full">
          {session.status === 'paused' ? (
            <Pause className="w-3 h-3 text-muted-foreground shrink-0" />
          ) : isRamping ? (
            <ArrowDown className="w-3 h-3 text-amber-500 shrink-0 animate-pulse" />
          ) : (
            <Play className="w-3 h-3 text-primary shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium truncate">{session.profile?.name}</span>
              <Badge variant={session.status === 'paused' ? 'secondary' : 'outline'} className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                {session.current_step_index + 1}/{session.steps?.length || 0}
              </Badge>
              {isRamping && (
                <span className="text-[10px] text-amber-500 font-medium shrink-0">
                  {Math.round(rampProgress * 100)}%
                </span>
              )}
            </div>
            {currentStep && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                {/* Temperature display: Running Target (→ Final Target for ramps) */}
                <span className="flex items-center gap-0.5">
                  <Thermometer className="w-3 h-3 text-muted-foreground" />
                  {/* Running target (controller's current target) - highlighted for ramps */}
                  {controllerData?.target_temp != null && (
                    <span className={`font-medium ${
                      isRamping ? 'text-amber-500' : 'text-primary'
                    }`}>
                      {controllerData.target_temp.toFixed(1)}°C
                    </span>
                  )}
                  {/* Show final target for linear ramps */}
                  {isRamping && currentStep.target_temp && 
                   controllerData?.target_temp != null && Math.abs(controllerData.target_temp - currentStep.target_temp) > 0.1 && (
                    <>
                      <span className="text-muted-foreground">↘</span>
                      <span className="text-primary/70">{currentStep.target_temp}°C</span>
                    </>
                  )}
                </span>
                {/* Separator */}
                <span className="text-muted-foreground/40">•</span>
                {/* Next step condition */}
                <span className="flex items-center gap-1 truncate">
                  {getStepIcon(currentStep.step_type)}
                  <span className="truncate">{getNextStepCondition(currentStep, session.step_started_at)}</span>
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-lg border bg-card p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-full ${session.status === 'paused' ? 'bg-muted' : 'bg-primary/20'}`}>
              {session.status === 'paused' ? (
                <Pause className="w-3 h-3 text-muted-foreground" />
              ) : (
                <Play className="w-3 h-3 text-primary" />
              )}
            </div>
            <div>
              <div className="text-sm font-medium">{session.profile?.name}</div>
              <div className="text-xs text-muted-foreground">
                Startad {formatDistanceToNow(new Date(session.started_at), { addSuffix: true, locale: sv })}
              </div>
            </div>
          </div>
          <Badge variant={session.status === 'paused' ? 'secondary' : 'default'}>
            {SESSION_STATUS_LABELS[session.status]}
          </Badge>
        </div>

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
          <div className="bg-muted/50 rounded-md p-2 space-y-2">
            <div className="flex items-center gap-2">
              <div className="p-1 rounded bg-background">
                {getStepIcon(currentStep.step_type)}
              </div>
              <div className="flex-1">
                <div className="text-xs font-medium">{STEP_TYPE_LABELS[currentStep.step_type]}</div>
                <div className="text-xs text-muted-foreground">{getStepDescription(currentStep)}</div>
              </div>
            </div>
            
            {/* Temperature display: Running Target (→ Final for ramps) */}
            {controllerData?.target_temp != null && (
              <div className="flex items-center gap-2 py-1.5 px-2 bg-background/50 rounded text-xs">
                <Thermometer className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  {/* Running target (controller's current setpoint) */}
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">Mål:</span>
                    <span className={`font-medium ${
                      currentStep.step_type === 'ramp' && currentStep.ramp_type === 'linear'
                        ? 'text-amber-500'
                        : 'text-primary'
                    }`}>
                      {controllerData.target_temp.toFixed(1)}°C
                    </span>
                  </div>

                  {/* Final target for linear ramps */}
                  {currentStep.step_type === 'ramp' && currentStep.ramp_type === 'linear' && currentStep.target_temp && 
                   Math.abs(controllerData.target_temp - currentStep.target_temp) > 0.1 && (
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">↘ Slut:</span>
                      <span className="font-medium text-primary/70">{currentStep.target_temp}°C</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {/* Step progress for time-based steps */}
            {(currentStep.step_type === 'hold' || (currentStep.step_type === 'ramp' && currentStep.ramp_type === 'linear')) && currentStep.duration_hours && (
              <div className="space-y-1">
                <Progress value={stepProgress} className="h-1" />
                <div className="text-xs text-muted-foreground text-right">
                  {Math.round(stepProgress)}% av {currentStep.duration_hours}h
                </div>
              </div>
            )}

            {/* Info for condition-based steps */}
            {(currentStep.step_type === 'wait_for_gravity_stable' || currentStep.step_type === 'wait_for_sg' || currentStep.step_type === 'wait_for_temp') && (
              <div className="text-xs text-muted-foreground italic">
                Väntar på att villkoret ska uppfyllas...
              </div>
            )}
          </div>
        )}

        {/* Steps Overview */}
        {session.steps && session.steps.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {session.steps.map((step, index) => (
              <div
                key={step.id}
                className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border ${
                  index < session.current_step_index
                    ? 'bg-primary/20 border-primary/30 text-primary'
                    : index === session.current_step_index
                    ? 'bg-primary border-primary text-primary-foreground'
                    : 'bg-muted border-border text-muted-foreground'
                }`}
              >
                {index < session.current_step_index ? (
                  <ChevronRight className="h-2.5 w-2.5" />
                ) : (
                  getStepIcon(step.step_type)
                )}
                <span>{index + 1}</span>
              </div>
            ))}
          </div>
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
