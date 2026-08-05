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
  const [originalTarget, setOriginalTarget] = useState<number | null>(null);
  const [dutyCyclePct, setDutyCyclePct] = useState<number | null>(null);
  const [dutyMode, setDutyMode] = useState<'cooling' | 'heating' | null>(null);
  const [isPi, setIsPi] = useState(false);
  const [piHeartbeat, setPiHeartbeat] = useState<string | null>(null);
  const [piCoolingOn, setPiCoolingOn] = useState(false);
  const [piHeatingOn, setPiHeatingOn] = useState(false);
  const [piTarget, setPiTarget] = useState<number | null>(null);

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
          .select('profile_target_temp, actuation, is_glycol_cooler, target_temp')
          .eq('controller_id', controller.controller_id)
          .single(),
      ]);

      setHasActiveSession(!!sessionData);
      const piActuated = (ctrlData as any)?.actuation === 'pi';
      setIsPi(piActuated);

      if (ctrlData?.profile_target_temp != null) {
        setOriginalTarget(ctrlData.profile_target_temp);
      } else {
        setOriginalTarget(null);
      }

      // Pi-actuated tanks: duty/mode/relays come from the local regulator, not RAPT PID logs
      if (piActuated) {
        // Glykolkylaren: Pi:n härleder målet lokalt — visa bara dess värde.
        const isGlycol = (ctrlData as any)?.is_glycol_cooler === true;
        const { data: live } = await supabase
          .from('pi_live_state')
          .select('duty_pct, mode, cooling_relay_on, heating_relay_on, last_heartbeat')
          .eq('controller_id', controller.controller_id)
          .maybeSingle();
        setDutyCyclePct(live?.duty_pct != null ? Number(live.duty_pct) : null);
        setDutyMode(live?.mode === 'cooling' || live?.mode === 'heating' ? live.mode : null);
        setPiCoolingOn(!!live?.cooling_relay_on);
        setPiHeatingOn(!!live?.heating_relay_on);
        setPiHeartbeat(live?.last_heartbeat ?? null);

        if (isGlycol) {
          const piDerived = (ctrlData as any)?.target_temp;
          if (piDerived != null) {
            setPiTarget(Number(piDerived));
            setTargetTemp(Math.round(Number(piDerived)));
          }
          return;
        }

        const { data: sp } = await supabase
          .from('pi_setpoint')
          .select('target_temp')
          .eq('controller_id', controller.controller_id)
          .maybeSingle();
        if (sp?.target_temp != null) {
          setPiTarget(Number(sp.target_temp));
          setTargetTemp(Math.round(Number(sp.target_temp)));
        }
        return;
      }

      // Non-Pi controllers no longer have a cloud duty-cycle source
      setDutyCyclePct(null);
      setDutyMode(null);
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
        .select('last_rapt_quick_sync_at')
        .single();

      if (data?.last_rapt_quick_sync_at) {
        setLastSync(data.last_rapt_quick_sync_at);
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
              const data = payload.new as { last_rapt_quick_sync_at: string | null };
              if (data.last_rapt_quick_sync_at) {
                setLastSync(data.last_rapt_quick_sync_at);
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
      if ((controller as any).is_glycol_cooler) {
        toast({
          title: "Styrs lokalt",
          description: "Glykolkylarens mål härleds av Pi:n (lägsta tankmål − 6°) och kan inte sättas härifrån.",
        });
        setLoading(false);
        return;
      }

      if (isPi) {
        const { error: piError } = await supabase
          .from('pi_setpoint')
          .upsert(
            {
              controller_id: controller.controller_id,
              target_temp: targetTemp,
              set_by: 'cloud',
              set_at: new Date().toISOString(),
            },
            { onConflict: 'controller_id' }
          );
        if (piError) throw piError;

        onOpenChange(false);
        setShowTempAdjust(false);
        toast({
          title: "Måltemperatur uppdaterad",
          description: `${controller.name} måltemperatur är nu ${targetTemp}° (Pi)`,
        });
        return;
      }

      // Only Pi-actuated controllers support target temperature updates now
      toast({
        title: "Fel vid uppdatering",
        description: `Kontrollern "${controller.name}" styrs inte av en Pi och kan inte uppdateras härifrån.`,
        variant: "destructive",
      });
    } catch (error) {
      console.error('Error updating target temperature:', error);
      toast({
        title: "Fel vid uppdatering",
        description: "Kunde inte uppdatera måltemperatur",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [controller.controller_id, controller.name, targetTemp, onOpenChange, toast, isPi]);

  // Derived state — safely access fields that exist on the full controller type
  const ctrl = currentController as Partial<RaptTempController>;
  const coolingHyst = ctrl.cooling_hysteresis ?? 0.2;
  const heatingHyst = ctrl.heating_hysteresis ?? 0.2;

  const sensorTemp = ctrl.actual_temp ?? null;
  const isActivelyCooling = isPi ? piCoolingOn : ctrl.cooling_enabled === true &&
    sensorTemp != null &&
    ctrl.target_temp != null &&
    sensorTemp > (ctrl.target_temp + coolingHyst);

  const isActivelyHeating = isPi ? piHeatingOn : ctrl.heating_enabled === true &&
    sensorTemp != null &&
    ctrl.target_temp != null &&
    sensorTemp < (ctrl.target_temp - heatingHyst);

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
    originalTarget,
    dutyCyclePct,
    dutyMode,
    isPi,
    piHeartbeat,
    piTarget,
  };
}
