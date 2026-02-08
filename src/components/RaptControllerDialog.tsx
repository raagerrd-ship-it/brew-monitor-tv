import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { Loader2, Thermometer, Clock, RefreshCw, Lock, Flame, Snowflake, Plus, Pencil } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { sv } from 'date-fns/locale';
import { ControllerTempChart } from './controller-chart';
import { StartFermentationSessionDialog, ActiveFermentationSession } from './fermentation';
import { CoolerFollowedSessions } from './CoolerFollowedSessions';
import { getControllerColor } from '@/lib/brew-utils';

interface TempController {
  id: string;
  controller_id: string;
  name: string;
  current_temp: number | null;
  pill_temp: number | null;
  target_temp: number | null;
  last_update: string | null;
  min_target_temp: number | null;
  max_target_temp: number | null;
  cooling_enabled: boolean | null;
  heating_enabled: boolean | null;
  heating_utilisation: number | null;
}

interface RaptControllerDialogProps {
  controller: TempController;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isCooler?: boolean;
}

export function RaptControllerDialog({ controller, open, onOpenChange, isCooler = false }: RaptControllerDialogProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [targetTemp, setTargetTemp] = useState(controller.target_temp !== null ? Math.round(controller.target_temp) : 12);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [currentController, setCurrentController] = useState(controller);
  const [showStartSessionDialog, setShowStartSessionDialog] = useState(false);
  const [hasActiveSession, setHasActiveSession] = useState(false);
  const [showTempAdjust, setShowTempAdjust] = useState(false);

  const controllerColor = getControllerColor(controller.name);

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
      
      // Subscribe to changes
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

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [open, controller.controller_id]);

  useEffect(() => {
    const fetchLastSync = async () => {
      const { data } = await supabase
        .from('sync_settings')
        .select('last_rapt_sync_at, last_rapt_quick_sync_at')
        .single();
      
      if (data) {
        // Använd den senaste av de två synkroniseringstiderna
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
      setCurrentController(controller);
      
      // Update targetTemp when dialog opens with new controller
      if (controller.target_temp !== null) {
        setTargetTemp(Math.round(controller.target_temp));
      }
      
      // Set up realtime subscription for this specific controller
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
              const updatedController = payload.new as TempController;
              setCurrentController(updatedController);
              if (updatedController.target_temp !== null) {
                setTargetTemp(Math.round(updatedController.target_temp));
              }
            }
          }
        )
        .subscribe();
      
      // Set up realtime subscription for sync settings
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
            console.log('Sync settings realtime update:', payload);
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

  const handleSetTargetTemperature = async () => {
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

      // Check if the response contains an error
      if (data?.error) {
        throw new Error(data.error);
      }

      // Close dialog to trigger data refresh
      onOpenChange(false);
      
      // Hide the adjustment panel
      setShowTempAdjust(false);
      
      toast({
        title: "Måltemperatur uppdaterad",
        description: `${controller.name} måltemperatur är nu ${targetTemp}°C`,
      });
    } catch (error) {
      console.error('Error updating target temperature:', error);
      const errorMessage = error instanceof Error ? error.message : "Kunde inte uppdatera måltemperatur";
      
      // Check for specific RAPT API errors
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
  };

  // Determine if currently cooling or heating
  const isActivelyCooling = currentController.cooling_enabled && 
    currentController.heating_utilisation === 0 && 
    currentController.current_temp !== null &&
    currentController.target_temp !== null &&
    currentController.current_temp > currentController.target_temp;
  
  const isActivelyHeating = currentController.heating_utilisation !== null && currentController.heating_utilisation > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] bg-background/95 backdrop-blur-xl border-border/50 max-h-[90vh] overflow-y-auto">
        <DialogHeader className="pb-2">
          <DialogTitle className="flex items-center gap-3">
            <div 
              className="p-2 rounded-lg" 
              style={{ backgroundColor: `${controllerColor}20` }}
            >
              {isCooler ? (
                <Snowflake className="w-5 h-5" style={{ color: controllerColor }} />
              ) : (
                <Thermometer className="w-5 h-5" style={{ color: controllerColor }} />
              )}
            </div>
            <span>{controller.name}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Active Fermentation Session */}
          {!isCooler && <ActiveFermentationSession controllerId={controller.controller_id} />}
          
          {/* Cooler: show followed controllers' fermentation sessions */}
          {isCooler && <CoolerFollowedSessions isAuthenticated={isAuthenticated} />}

          {/* Temperature Stats Grid */}
          <div className="grid grid-cols-2 gap-3">
            {/* Current temp */}
            <div className="bg-muted/30 backdrop-blur-sm rounded-xl p-4 border border-border/30">
              <p className="text-xs text-muted-foreground mb-1">Aktuell temp</p>
              <p className="text-2xl font-bold tabular-nums" style={{ color: controllerColor }}>
                {currentController.current_temp !== null ? `${currentController.current_temp.toFixed(1)}°` : '—'}
              </p>
              <p className="text-[10px] text-muted-foreground/70 mt-1">Inbyggd sensor</p>
            </div>
            
            {/* Target temp - clickable when authenticated */}
            <div 
              className={`bg-muted/30 backdrop-blur-sm rounded-xl p-4 border border-border/30 transition-all ${
                isAuthenticated && !hasActiveSession ? 'cursor-pointer hover:bg-muted/50 hover:border-primary/30' : ''
              }`}
              onClick={() => {
                if (isAuthenticated && !hasActiveSession) {
                  setShowTempAdjust(!showTempAdjust);
                }
              }}
            >
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-muted-foreground">Måltemperatur</p>
                {isAuthenticated && !hasActiveSession && (
                  <Pencil className="w-3 h-3 text-muted-foreground/50" />
                )}
              </div>
              <p className="text-2xl font-bold tabular-nums text-primary">
                {currentController.target_temp !== null ? `${currentController.target_temp.toFixed(1)}°` : '—'}
              </p>
              {currentController.pill_temp !== null && (
                <p className="text-[10px] text-muted-foreground/70 mt-1">
                  Pill: {currentController.pill_temp.toFixed(1)}°C
                </p>
              )}
            </div>
          </div>

          {/* Temperature adjustment - shown when clicking target temp */}
          {isAuthenticated && showTempAdjust && !hasActiveSession && (
            <div className="space-y-3 p-3 bg-muted/20 rounded-xl border border-border/30 animate-fade-in">
              <div className="flex items-center justify-between">
                <Label htmlFor="target-temp" className="text-xs font-medium text-muted-foreground">
                  Ändra måltemperatur
                </Label>
                <span className="text-lg font-bold text-primary tabular-nums">
                  {targetTemp}°C
                </span>
              </div>
              
              <Slider
                id="target-temp"
                min={currentController.min_target_temp ?? -5}
                max={currentController.max_target_temp ?? 25}
                step={1}
                value={[targetTemp]}
                onValueChange={(value) => setTargetTemp(value[0])}
                disabled={loading}
                className="py-1"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>{currentController.min_target_temp ?? -5}°C</span>
                <span>{currentController.max_target_temp ?? 25}°C</span>
              </div>
              <Button 
                onClick={handleSetTargetTemperature} 
                disabled={loading}
                className="w-full"
                size="sm"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Sätt måltemperatur'}
              </Button>
            </div>
          )}

          {/* Heating/Cooling Status */}
          <div className="flex gap-2">
            <div className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg transition-all ${
              isActivelyHeating 
                ? 'bg-orange-500/15 border border-orange-500/30' 
                : 'bg-muted/20 border border-border/20'
            }`}>
              <Flame className={`w-4 h-4 ${isActivelyHeating ? 'text-orange-500' : 'text-muted-foreground/40'}`} />
              {isActivelyHeating && <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />}
              <span className={`text-xs font-medium ${
                isActivelyHeating ? 'text-orange-600 dark:text-orange-400' : 'text-muted-foreground/60'
              }`}>
                {!currentController.heating_enabled ? 'Inaktiv' : isActivelyHeating ? 'Värmer' : 'Standby'}
              </span>
            </div>
            
            <div className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg transition-all ${
              isActivelyCooling 
                ? 'bg-blue-500/15 border border-blue-500/30' 
                : 'bg-muted/20 border border-border/20'
            }`}>
              <Snowflake className={`w-4 h-4 ${isActivelyCooling ? 'text-blue-500' : 'text-muted-foreground/40'}`} />
              {isActivelyCooling && <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />}
              <span className={`text-xs font-medium ${
                isActivelyCooling ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground/60'
              }`}>
                {!currentController.cooling_enabled ? 'Inaktiv' : isActivelyCooling ? 'Kyler' : 'Standby'}
              </span>
            </div>
          </div>

          {/* Timestamps */}
          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              <span>Data: {currentController.last_update 
                ? formatDistanceToNow(new Date(currentController.last_update), { addSuffix: true, locale: sv })
                : '—'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <RefreshCw className="w-3 h-3" />
              <span>Synk: {lastSync 
                ? formatDistanceToNow(new Date(lastSync), { addSuffix: true, locale: sv })
                : '—'}</span>
            </div>
          </div>

          {/* Temperature Chart */}
          <div className="bg-muted/20 backdrop-blur-sm rounded-xl p-4 border border-border/30">
            <ControllerTempChart 
              controllerId={controller.controller_id} 
              controllerColor={controllerColor}
            />
          </div>
        </div>


        {/* Warning when session is active */}
        {isAuthenticated && hasActiveSession && (
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 rounded-lg border border-amber-500/20 mt-4">
            <Lock className="w-4 h-4 text-amber-500 shrink-0" />
            <span className="text-xs text-amber-600 dark:text-amber-400">
              Temperaturen styrs av den aktiva fermenteringsprofilen
            </span>
          </div>
        )}
            
        {/* Start Profile Button - only show for non-cooler controllers */}
        {isAuthenticated && !isCooler && !hasActiveSession && (
          <Button
            variant="outline"
            size="sm"
            className="w-full mt-4"
            onClick={() => setShowStartSessionDialog(true)}
          >
            <Plus className="w-4 h-4 mr-2" />
            Starta fermenteringsprofil
          </Button>
        )}

        {!isAuthenticated && (
          <div className="bg-muted/30 backdrop-blur-sm p-4 rounded-xl flex items-center gap-3 border border-border/30 mt-4">
            <Lock className="w-4 h-4 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-xs font-medium">Logga in för att ändra temperatur</p>
            </div>
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                onOpenChange(false);
                navigate("/login");
              }}
            >
              Logga in
            </Button>
          </div>
        )}
      </DialogContent>

      {/* Start Session Dialog */}
      {!isCooler && (
        <StartFermentationSessionDialog
          open={showStartSessionDialog}
          onOpenChange={setShowStartSessionDialog}
          preselectedControllerId={controller.controller_id}
        />
      )}
    </Dialog>
  );
}
