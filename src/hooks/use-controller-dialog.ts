import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { TempController } from '@/types/brew';
import type { Tables } from '@/integrations/supabase/types';

type RaptTempController = Tables<'rapt_temp_controllers'>;

interface ControllerDialogOptions {
  controller: {
    controller_id: string;
    target_temp: number | null;
    name: string;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function useControllerDialog({ controller, open, onOpenChange }: ControllerDialogOptions) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [targetTemp, setTargetTemp] = useState(controller.target_temp !== null ? Math.round(controller.target_temp) : 12);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [currentController, setCurrentController] = useState<RaptTempController | typeof controller>(controller);
  const [hasActiveSession, setHasActiveSession] = useState(false);
  const [showTempAdjust, setShowTempAdjust] = useState(false);
  const [dualSensorEnabled, setDualSensorEnabled] = useState(false);
  const [originalTarget, setOriginalTarget] = useState<number | null>(null);
  const [dutyCyclePct, setDutyCyclePct] = useState<number | null>(null);
  const [dutyMode, setDutyMode] = useState<'cooling' | 'heating' | null>(null);
  const [preferredSensor, setPreferredSensorState] = useState<'pill' | 'probe'>('pill');

  // Check authentication
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAuthenticated(!!session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setIsAuthenticated(!!session);
    });

    return () => subscription.unsubscribe();
  }, [controller.controller_id]);

  // Check for active fermentation session + fetch original target + duty cycle
  useEffect(() => {
    const loadSessionAndTarget = async () => {
      // Check active session
      const [{ data: sessionData }, { data: ctrlData }] = await Promise.all([
        supabase
          .from('fermentation_sessions')
          .select('id')
          .eq('controller_id', controller.controller_id)
          .in('status', ['running', 'paused'])
          .maybeSingle(),
        supabase
          .from('rapt_temp_controllers')
          .select('profile_target_temp, dual_sensor_enabled, preferred_sensor')
          .eq('controller_id', controller.controller_id)
          .single(),
      ]);

      setHasActiveSession(!!sessionData);
      setDualSensorEnabled(ctrlData?.dual_sensor_enabled ?? false);
      setPreferredSensorState((ctrlData as any)?.preferred_sensor ?? 'pill');

      if (ctrlData?.profile_target_temp != null) {
        setOriginalTarget(ctrlData.profile_target_temp);
      } else {
        setOriginalTarget(null);
      }

      // Fetch latest duty cycle from decision logs
      const { data: logData } = await supabase
        .from('auto_cooling_decision_logs')
        .select('decisions')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (logData?.decisions) {
        const decisions = logData.decisions as Array<{ name?: string; step?: string; details?: Record<string, unknown> }>;
        const pillCompStep = decisions.find(d =>
          d.step === 'PILL_COMP_STATUS' && d.name === controller.name
        );
        if (pillCompStep?.details) {
          const det = pillCompStep.details;
          setDutyCyclePct(typeof det.duty_pct === 'number' ? det.duty_pct : null);
          setDutyMode(typeof det.pid_mode === 'string' ? det.pid_mode as 'cooling' | 'heating' : null);
        } else {
          setDutyCyclePct(null);
          setDutyMode(null);
        }
      }
    };

    if (open) {
      loadSessionAndTarget();

      const channel = supabase
        .channel(`session-check-${controller.controller_id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'fermentation_sessions',
            filter: `controller_id=eq.${controller.controller_id}`
          },
          () => loadSessionAndTarget()
        )
        .subscribe();

      return () => { supabase.removeChannel(channel); };
    }
  }, [open, controller.controller_id]);

  // Realtime subscriptions for controller + sync data
  useEffect(() => {
    const fetchLastSync = async () => {
      const { data } = await supabase
        .from('sync_settings')
        .select('last_rapt_sync_at, last_rapt_quick_sync_at')
        .single();

      if (data) {
        const times = [data.last_rapt_sync_at, data.last_rapt_quick_sync_at].filter(Boolean) as string[];
        if (times.length > 0) {
          const mostRecent = times.reduce((latest, current) =>
            new Date(current) > new Date(latest) ? current : latest
          );
          setLastSync(mostRecent);
        }
      }
    };

    if (open) {
      fetchLastSync();
      setCurrentController(controller);

      if (controller.target_temp !== null) {
        setTargetTemp(Math.round(controller.target_temp));
      }

      const controllerChannel = supabase
        .channel(`controller_${controller.controller_id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'rapt_temp_controllers',
            filter: `controller_id=eq.${controller.controller_id}`
          },
          (payload) => {
            console.log('Controller realtime update:', payload);
            if (payload.eventType === 'UPDATE' && payload.new) {
              const updatedController = payload.new as RaptTempController;
              setCurrentController(updatedController);
              if (updatedController.target_temp !== null) {
                setTargetTemp(Math.round(updatedController.target_temp));
              }
            }
          }
        )
        .subscribe();

      const syncChannel = supabase
        .channel('sync_settings_updates')
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'sync_settings'
          },
          (payload) => {
            if (payload.new) {
              const data = payload.new as { last_rapt_sync_at: string | null; last_rapt_quick_sync_at: string | null };
              const times = [data.last_rapt_sync_at, data.last_rapt_quick_sync_at].filter(Boolean) as string[];
              if (times.length > 0) {
                const mostRecent = times.reduce((latest, current) =>
                  new Date(current) > new Date(latest) ? current : latest
                );
                setLastSync(mostRecent);
              }
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(controllerChannel);
        supabase.removeChannel(syncChannel);
      };
    }
  }, [open, controller, isAuthenticated]);

  const setTargetTemperature = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('rapt-update-controller', {
        body: {
          controllerId: controller.controller_id,
          action: 'setTargetTemperature',
          value: targetTemp
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      onOpenChange(false);
      setShowTempAdjust(false);

      toast({
        title: "Måltemperatur uppdaterad",
        description: `${controller.name} måltemperatur är nu ${targetTemp}°`,
      });
    } catch (error) {
      console.error('Error updating target temperature:', error);
      const errorMessage = error instanceof Error ? error.message : "Kunde inte uppdatera måltemperatur";

      let userFriendlyMessage = errorMessage;
      if (errorMessage.includes('not registered')) {
        userFriendlyMessage = `Kontrollern "${controller.name}" är inte registrerad eller online i ditt RAPT-konto. Kontrollera att den är påslagen och ansluten.`;
      } else if (errorMessage.includes('RAPT API error')) {
        userFriendlyMessage = 'Kunde inte kommunicera med RAPT API:et. Kontrollera din internetanslutning och försök igen.';
      }

      toast({
        title: "Fel vid uppdatering",
        description: userFriendlyMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [controller.controller_id, controller.name, targetTemp, onOpenChange, toast]);

  // Derived state — safely access fields that exist on the full controller type
  const ctrl = currentController as Partial<RaptTempController>;
  const coolingHyst = ctrl.cooling_hysteresis ?? 0.2;
  const heatingHyst = ctrl.heating_hysteresis ?? 0.2;

  const isActivelyCooling = ctrl.cooling_enabled === true &&
    ctrl.current_temp != null &&
    ctrl.target_temp != null &&
    ctrl.current_temp > (ctrl.target_temp + coolingHyst);

  const isActivelyHeating = ctrl.heating_enabled === true &&
    ctrl.current_temp != null &&
    ctrl.target_temp != null &&
    ctrl.current_temp < (ctrl.target_temp - heatingHyst);

  const toggleDualSensor = useCallback(async () => {
    const newValue = !dualSensorEnabled;
    setDualSensorEnabled(newValue);
    await supabase
      .from('rapt_temp_controllers')
      .update({ dual_sensor_enabled: newValue } as any)
      .eq('controller_id', controller.controller_id);
  }, [controller.controller_id, dualSensorEnabled]);

  const setPreferredSensor = useCallback(async (value: 'pill' | 'probe') => {
    setPreferredSensorState(value);
    await supabase
      .from('rapt_temp_controllers')
      .update({ preferred_sensor: value } as any)
      .eq('controller_id', controller.controller_id);
  }, [controller.controller_id]);

  return {
    loading,
    isAuthenticated,
    targetTemp,
    setTargetTemp,
    lastSync,
    currentController: currentController as RaptTempController,
    hasActiveSession,
    showTempAdjust,
    setShowTempAdjust,
    setTargetTemperature,
    isActivelyCooling,
    isActivelyHeating,
    dualSensorEnabled,
    toggleDualSensor,
    originalTarget,
    dutyCyclePct,
    dutyMode,
  };
}
