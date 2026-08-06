import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  FermentationSession,
  FermentationProfile,
  FermentationProfileStep,
  SessionStatus,
} from "@/types/fermentation";
import { FermentationSessionData } from "@/types/brew";
import { useTvMode } from "@/contexts/TvModeContext";

interface UseActiveFermentationSessionParams {
  controllerId?: string;
  brewId?: string;
  compact?: boolean;
  preloadedSession?: FermentationSessionData | null;
  isAuthenticated?: boolean;
  currentSg?: number | null;
  originalGravity?: number | null;
}

export interface SessionWithDetails extends FermentationSession {
  profile?: FermentationProfile;
  steps?: FermentationProfileStep[];
}

export interface ControllerData {
  current_temp: number | null;
  pill_temp: number | null;
  actual_temp: number | null;
  target_temp: number | null;
  profile_target_temp: number | null;
  name: string;
}

export function useActiveFermentationSession({
  controllerId,
  brewId,
  compact = false,
  preloadedSession,
  isAuthenticated: isAuthenticatedProp,
}: UseActiveFermentationSessionParams) {
  const [session, setSession] = useState<SessionWithDetails | null>(null);
  const [controllerData, setControllerData] = useState<ControllerData | null>(null);
  const [loading, setLoading] = useState(!preloadedSession);
  const [actionLoading, setActionLoading] = useState(false);
  const [skipLoading, setSkipLoading] = useState(false);
  const [acknowledgeLoading, setAcknowledgeLoading] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [isAuthenticatedLocal, setIsAuthenticatedLocal] = useState(false);
  const [, setTick] = useState(0);
  const { toast } = useToast();
  const { isTvMode } = useTvMode();

  const isAuthenticated = isAuthenticatedProp ?? isAuthenticatedLocal;

  // Auth check
  useEffect(() => {
    if (isAuthenticatedProp === undefined) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        setIsAuthenticatedLocal(!!session);
      });
    }
  }, [isAuthenticatedProp]);

  // Progress tick
  const lastMinuteRef = useRef(-1);
  useEffect(() => {
    const checkInterval = isTvMode ? 30000 : 5000;
    const intervalId = setInterval(() => {
      const currentMinute = Math.floor(Date.now() / 60000);
      if (currentMinute !== lastMinuteRef.current) {
        lastMinuteRef.current = currentMinute;
        setTick(t => t + 1);
      }
    }, checkInterval);
    return () => clearInterval(intervalId);
  }, [isTvMode]);

  // Preloaded session mapping
  useEffect(() => {
    if (preloadedSession && compact) {
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
        notes: s.notes ?? null,
        gravity_threshold: s.gravity_threshold ?? null,
        attenuation_trigger: s.attenuation_trigger ?? null,
        activity_trigger: s.activity_trigger ?? null,
        temp_increase: s.temp_increase ?? null,
        min_ramp_hours: s.min_ramp_hours ?? null,
        ramp_curve: s.ramp_curve ?? null,
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
        ramp_triggered_at: preloadedSession.ramp_triggered_at ?? null,
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
        pill_temp: preloadedSession.controller_pill_temp ?? null,
        actual_temp: preloadedSession.controller_actual_temp ?? null,
        target_temp: preloadedSession.controller_target_temp,
        profile_target_temp: preloadedSession.controller_profile_target_temp ?? null,
        name: '',
      });

      setLoading(false);
    }
  }, [preloadedSession, compact, brewId]);

  // Realtime: keep controllerData in sync with rapt_temp_controllers for any active session.
  // Subscribes for both preloaded (compact) and non-preloaded (expanded/loadSession) paths
  // so profile_target_temp updates (e.g. step skips) propagate without a page reload.
  const realtimeControllerId =
    (preloadedSession && compact ? preloadedSession.controller_id : null) ??
    session?.controller_id ??
    controllerId ??
    null;

  useEffect(() => {
    const cId = realtimeControllerId;
    if (!cId) return;

    const channel = supabase
      .channel(`ferm-ctrl-${cId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'rapt_temp_controllers',
        filter: `controller_id=eq.${cId}`,
      }, (payload) => {
        const newData = payload.new as Record<string, number | null>;
        setControllerData(prev => ({
          ...prev,
          current_temp: newData.current_temp ?? prev?.current_temp ?? null,
          pill_temp: newData.pill_temp ?? prev?.pill_temp ?? null,
          actual_temp: newData.actual_temp ?? prev?.actual_temp ?? null,
          target_temp: newData.target_temp ?? prev?.target_temp ?? null,
          profile_target_temp: newData.profile_target_temp ?? prev?.profile_target_temp ?? null,
          name: prev?.name ?? '',
        }));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [realtimeControllerId]);

  // Load session (non-preloaded)
  const loadSession = useCallback(async () => {
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
        supabase.from('fermentation_profiles').select('*').eq('id', sessions.profile_id).single(),
        supabase.from('fermentation_profile_steps').select('*').eq('profile_id', sessions.profile_id).order('step_order'),
        supabase.from('rapt_temp_controllers').select('current_temp, pill_temp, actual_temp, target_temp, profile_target_temp, name').eq('controller_id', sessions.controller_id).single(),
      ]);

      setSession({
        ...sessions as FermentationSession,
        profile: profileRes.data as FermentationProfile | undefined,
        steps: stepsRes.data as FermentationProfileStep[] | undefined,
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

  useEffect(() => {
    if (!preloadedSession || !compact) {
      loadSession();
    }
  }, [loadSession, preloadedSession, compact]);


  // Progress calculations
  const calculateProgress = useCallback(() => {
    if (!session?.steps?.length) return 0;
    const totalSteps = session.steps.length;
    const completedSteps = session.current_step_index;
    const currentStep = session.steps[session.current_step_index];
    let currentStepProgress = 0;
    if (currentStep && (currentStep.step_type === 'hold' || (currentStep.step_type === 'ramp' && currentStep.ramp_type === 'linear'))) {
      if (currentStep.duration_hours) {
        const stepStarted = new Date(session.step_started_at);
        const elapsed = (Date.now() - stepStarted.getTime()) / (1000 * 60 * 60);
        currentStepProgress = Math.min(elapsed / currentStep.duration_hours, 1);
      }
    }
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
    if (!currentStep || currentStep.step_type !== 'ramp' || currentStep.ramp_type !== 'linear') return null;
    if (!currentStep.duration_hours) return null;
    const stepStarted = new Date(session.step_started_at);
    const elapsed = (Date.now() - stepStarted.getTime()) / (1000 * 60 * 60);
    return Math.min(Math.max(elapsed / currentStep.duration_hours, 0), 1);
  }, [session]);

  return {
    session,
    controllerData,
    loading,
    isAuthenticated,
    calculateProgress,
    calculateStepProgress,
    getRampProgress,
  };
}
