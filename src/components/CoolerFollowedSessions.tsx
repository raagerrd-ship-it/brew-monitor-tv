import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, SkipForward, Thermometer } from "lucide-react";
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
import { getControllerColor } from "@/lib/brew-utils";

interface FollowedSession {
  sessionId: string;
  controllerId: string;
  controllerName: string;
  profileName: string;
  currentStepIndex: number;
  totalSteps: number;
  currentStepType: string;
  currentStepTargetTemp: number | null;
  currentTemp: number | null;
  targetTemp: number | null;
  status: string;
}

interface CoolerFollowedSessionsProps {
  isAuthenticated: boolean;
}

const STEP_TYPE_LABELS: Record<string, string> = {
  ramp: 'Ramp',
  hold: 'Håll',
  wait_for_temp: 'Vänta på temp',
  wait_for_gravity_stable: 'Stabil SG',
  wait_for_sg: 'Mål-SG',
};

export function CoolerFollowedSessions({ isAuthenticated }: CoolerFollowedSessionsProps) {
  const [sessions, setSessions] = useState<FollowedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [skipLoadingId, setSkipLoadingId] = useState<string | null>(null);
  const [skipConfirmSession, setSkipConfirmSession] = useState<FollowedSession | null>(null);
  const { toast } = useToast();

  const loadFollowedSessions = useCallback(async () => {
    // Get followed controller IDs
    const { data: followed } = await supabase
      .from('auto_cooling_followed_controllers')
      .select('controller_id');

    if (!followed?.length) {
      setSessions([]);
      setLoading(false);
      return;
    }

    const controllerIds = followed.map(f => f.controller_id);

    // Get active sessions for these controllers
    const { data: activeSessions } = await supabase
      .from('fermentation_sessions')
      .select('id, controller_id, profile_id, current_step_index, step_started_at, status, step_start_temp')
      .in('controller_id', controllerIds)
      .in('status', ['running', 'paused']);

    if (!activeSessions?.length) {
      setSessions([]);
      setLoading(false);
      return;
    }

    // Fetch profiles, steps, and controller data in parallel
    const profileIds = [...new Set(activeSessions.map(s => s.profile_id))];
    const sessionControllerIds = [...new Set(activeSessions.map(s => s.controller_id))];

    const [profilesRes, stepsRes, controllersRes] = await Promise.all([
      supabase.from('fermentation_profiles').select('id, name').in('id', profileIds),
      supabase.from('fermentation_profile_steps').select('*').in('profile_id', profileIds).order('step_order'),
      supabase.from('rapt_temp_controllers').select('controller_id, name, current_temp, target_temp, pill_temp').in('controller_id', sessionControllerIds),
    ]);

    const profiles = new Map(profilesRes.data?.map(p => [p.id, p]) || []);
    const stepsByProfile = new Map<string, typeof stepsRes.data>();
    stepsRes.data?.forEach(step => {
      const existing = stepsByProfile.get(step.profile_id) || [];
      existing.push(step);
      stepsByProfile.set(step.profile_id, existing);
    });
    const controllerMap = new Map(controllersRes.data?.map(c => [c.controller_id, c]) || []);

    const result: FollowedSession[] = activeSessions.map(s => {
      const profile = profiles.get(s.profile_id);
      const steps = stepsByProfile.get(s.profile_id) || [];
      const controller = controllerMap.get(s.controller_id);
      const currentStep = steps[s.current_step_index];

      return {
        sessionId: s.id,
        controllerId: s.controller_id,
        controllerName: controller?.name || 'Okänd',
        profileName: profile?.name || 'Okänd profil',
        currentStepIndex: s.current_step_index,
        totalSteps: steps.length,
        currentStepType: currentStep?.step_type || 'hold',
        currentStepTargetTemp: currentStep?.target_temp ?? null,
        currentTemp: controller?.pill_temp ?? controller?.current_temp ?? null,
        targetTemp: controller?.target_temp ?? null,
        status: s.status,
      };
    });

    setSessions(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadFollowedSessions();
  }, [loadFollowedSessions]);

  const handleSkipStep = useCallback(async (session: FollowedSession) => {
    setSkipLoadingId(session.sessionId);

    const nextStepIndex = session.currentStepIndex + 1;

    if (nextStepIndex >= session.totalSteps) {
      // Complete the profile
      const { error } = await supabase
        .from('fermentation_sessions')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', session.sessionId);

      if (error) {
        toast({ title: "Fel", description: "Kunde inte slutföra profilen", variant: "destructive" });
      } else {
        await supabase.from('fermentation_step_log').insert({
          session_id: session.sessionId,
          step_index: session.currentStepIndex,
          action: 'skipped',
          details: { reason: 'manual_skip_from_cooler', message: 'Manuellt hoppat från kylardialogen - profil slutförd' }
        });
        toast({ title: "Profil slutförd", description: `${session.controllerName}: profil slutförd` });
        loadFollowedSessions();
      }
    } else {
      const { error } = await supabase
        .from('fermentation_sessions')
        .update({
          current_step_index: nextStepIndex,
          step_started_at: new Date().toISOString(),
          step_start_temp: session.targetTemp,
        })
        .eq('id', session.sessionId);

      if (error) {
        toast({ title: "Fel", description: "Kunde inte gå vidare till nästa steg", variant: "destructive" });
      } else {
        await supabase.from('fermentation_step_log').insert({
          session_id: session.sessionId,
          step_index: session.currentStepIndex,
          action: 'skipped',
          details: { reason: 'manual_skip_from_cooler', message: 'Manuellt hoppat från kylardialogen' }
        });
        toast({ title: "Steg hoppat", description: `${session.controllerName}: gått vidare till steg ${nextStepIndex + 1}` });
        loadFollowedSessions();
      }
    }

    setSkipLoadingId(null);
    setSkipConfirmSession(null);
  }, [toast, loadFollowedSessions]);

  if (loading) return null;
  if (sessions.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground px-1">Aktiva fermenteringsprofiler</p>
      {sessions.map(session => {
        const color = getControllerColor(session.controllerName);
        const isLastStep = session.currentStepIndex + 1 >= session.totalSteps;

        return (
          <div
            key={session.sessionId}
            className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/30"
          >
            {/* Controller indicator */}
            <div
              className="w-2 h-8 rounded-full shrink-0"
              style={{ backgroundColor: color }}
            />

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold truncate" style={{ color }}>
                  {session.controllerName}
                </span>
                <Badge variant="outline" className="text-xs shrink-0 px-1.5 py-0">
                  {session.currentStepIndex + 1} / {session.totalSteps}
                </Badge>
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                <span className="truncate">{session.profileName}</span>
                <span className="shrink-0">•</span>
                <span className="shrink-0">{STEP_TYPE_LABELS[session.currentStepType] || session.currentStepType}</span>
                {session.currentStepTargetTemp != null && (
                  <>
                    <Thermometer className="h-3 w-3 shrink-0" />
                    <span className="shrink-0">{session.currentStepTargetTemp}°C</span>
                  </>
                )}
              </div>
            </div>

            {/* Skip button */}
            {isAuthenticated && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSkipConfirmSession(session)}
                disabled={skipLoadingId === session.sessionId}
                className="shrink-0 h-8 px-2 text-xs gap-1"
              >
                {skipLoadingId === session.sessionId ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <SkipForward className="h-3.5 w-3.5" />
                    {isLastStep ? 'Slutför' : 'Nästa'}
                  </>
                )}
              </Button>
            )}
          </div>
        );
      })}

      {/* Confirmation dialog */}
      <AlertDialog open={!!skipConfirmSession} onOpenChange={(open) => !open && setSkipConfirmSession(null)}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {skipConfirmSession && skipConfirmSession.currentStepIndex + 1 >= skipConfirmSession.totalSteps
                ? 'Slutför fermenteringsprofil?'
                : 'Hoppa till nästa steg?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {skipConfirmSession && (
                <>
                  <strong>{skipConfirmSession.controllerName}</strong>: {skipConfirmSession.profileName}
                  <br />
                  {skipConfirmSession.currentStepIndex + 1 >= skipConfirmSession.totalSteps
                    ? 'Profilen kommer markeras som slutförd.'
                    : `Steg ${skipConfirmSession.currentStepIndex + 1} hoppas över och steg ${skipConfirmSession.currentStepIndex + 2} startar.`}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => skipConfirmSession && handleSkipStep(skipConfirmSession)}
            >
              {skipConfirmSession && skipConfirmSession.currentStepIndex + 1 >= skipConfirmSession.totalSteps
                ? 'Slutför'
                : 'Hoppa över'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
