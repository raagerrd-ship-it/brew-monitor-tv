import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { TempController } from '@/types/brew';

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
  const [currentController, setCurrentController] = useState(controller);
  const [hasActiveSession, setHasActiveSession] = useState(false);
  const [showTempAdjust, setShowTempAdjust] = useState(false);

  // Check authentication
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAuthenticated(!!session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setIsAuthenticated(!!session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Check for active fermentation session
  useEffect(() => {
    const checkActiveSession = async () => {
      const { data } = await supabase
        .from('fermentation_sessions')
        .select('id')
        .eq('controller_id', controller.controller_id)
        .in('status', ['running', 'paused'])
        .maybeSingle();

      setHasActiveSession(!!data);
    };

    if (open) {
      checkActiveSession();

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
          () => checkActiveSession()
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
        const times = [data.last_rapt_sync_at, data.last_rapt_quick_sync_at].filter(Boolean);
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
      setCurrentController(controller as any);

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
              const updatedController = payload.new as any;
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
              const times = [data.last_rapt_sync_at, data.last_rapt_quick_sync_at].filter(Boolean);
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

  // Derived state
  const coolingHyst = (currentController as any).cooling_hysteresis ?? 0.2;
  const heatingHyst = (currentController as any).heating_hysteresis ?? 0.2;

  const isActivelyCooling = (currentController as any).cooling_enabled &&
    (currentController as any).current_temp !== null &&
    (currentController as any).target_temp !== null &&
    (currentController as any).current_temp > ((currentController as any).target_temp + coolingHyst);

  const isActivelyHeating = (currentController as any).heating_enabled &&
    (currentController as any).current_temp !== null &&
    (currentController as any).target_temp !== null &&
    (currentController as any).current_temp < ((currentController as any).target_temp - heatingHyst);

  return {
    loading,
    isAuthenticated,
    targetTemp,
    setTargetTemp,
    lastSync,
    currentController: currentController as any,
    hasActiveSession,
    showTempAdjust,
    setShowTempAdjust,
    setTargetTemperature,
    isActivelyCooling,
    isActivelyHeating,
  };
}
