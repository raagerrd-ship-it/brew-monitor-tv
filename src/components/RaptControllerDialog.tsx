import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { Loader2, Thermometer, Clock, RefreshCw, Lock, AirVent, Flame, Snowflake } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { sv } from 'date-fns/locale';

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
}

export function RaptControllerDialog({ controller, open, onOpenChange }: RaptControllerDialogProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [targetTemp, setTargetTemp] = useState(controller.target_temp !== null ? Math.round(controller.target_temp) : 12);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [currentController, setCurrentController] = useState(controller);

  // Get controller color based on name
  const getControllerColor = (name: string): string => {
    const lowerName = name.toLowerCase();
    
    const colorMatches: Array<[string[], string]> = [
      [['red', 'röd'], '#ef4444'],
      [['blue', 'blå'], '#3b82f6'],
      [['green', 'grön'], '#22c55e'],
      [['yellow', 'gul'], '#eab308'],
      [['purple', 'lila'], '#a855f7'],
      [['pink', 'rosa'], '#ec4899'],
      [['orange'], '#f97316'],
      [['cyan'], '#06b6d4'],
      [['lime'], '#84cc16'],
      [['amber', 'bärnsten'], '#f59e0b'],
      [['teal', 'turkos'], '#14b8a6'],
      [['indigo'], '#6366f1'],
      [['violet', 'violett'], '#8b5cf6'],
      [['fuchsia'], '#d946ef'],
      [['rose'], '#f43f5e'],
      [['sky', 'himmel'], '#0ea5e9'],
      [['emerald', 'smaragd'], '#10b981'],
      [['slate', 'skiffer'], '#64748b'],
      [['gray', 'grey', 'grå'], '#6b7280'],
      [['zinc', 'zink'], '#71717a'],
      [['neutral', 'neutral'], '#737373'],
      [['stone', 'sten'], '#78716c'],
      [['white', 'vit'], '#f1f5f9'],
      [['black', 'svart'], '#1e293b'],
    ];

    for (const [keywords, hex] of colorMatches) {
      if (keywords.some(keyword => lowerName.includes(keyword))) {
        return hex;
      }
    }
    
    return 'currentColor';
  };

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
  }, [open, controller]);

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


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[380px] bg-background border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AirVent className="w-5 h-5" style={{ color: controllerColor }} />
            {controller.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5 py-1">
          {/* Pill Temperature (if available) */}
          {currentController.pill_temp !== null && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Thermometer className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs text-muted-foreground">Pill-temperatur</span>
              </div>
              <span className="text-sm font-semibold text-primary">
                {currentController.pill_temp.toFixed(1)}°C
              </span>
            </div>
          )}

          {/* Built-in Temperature */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Thermometer className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Inbyggd sensor</span>
            </div>
            <span className="text-sm font-semibold">
              {currentController.current_temp !== null ? `${currentController.current_temp.toFixed(1)}°C` : 'Okänd'}
            </span>
          </div>

          {/* Target Temperature Display */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Thermometer className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Måltemperatur</span>
            </div>
            <span className="text-sm font-semibold">
              {currentController.target_temp !== null ? `${currentController.target_temp.toFixed(1)}°C` : 'Ej satt'}
            </span>
          </div>

          {/* Heating/Cooling Status */}
          <div className="flex items-center justify-between py-2 border-t">
            <div className="flex gap-3">
              <div className="flex items-center gap-1.5">
                <Flame className={`w-4 h-4 ${currentController.heating_enabled ? 'text-orange-500' : 'text-muted-foreground/40'}`} />
                <span className={`text-xs ${currentController.heating_enabled ? 'font-medium text-foreground' : 'text-muted-foreground/60'}`}>
                  Värme
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Snowflake className={`w-4 h-4 ${currentController.cooling_enabled ? 'text-blue-500' : 'text-muted-foreground/40'}`} />
                <span className={`text-xs ${currentController.cooling_enabled ? 'font-medium text-foreground' : 'text-muted-foreground/60'}`}>
                  Kyla
                </span>
              </div>
            </div>
            {currentController.heating_utilisation !== null && currentController.heating_utilisation > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs font-medium text-green-600">
                  Aktiv {currentController.heating_utilisation.toFixed(0)}%
                </span>
              </div>
            )}
          </div>

          {/* Last Update */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Senaste data</span>
            </div>
            <span className="text-xs">
              {currentController.last_update 
                ? formatDistanceToNow(new Date(currentController.last_update), { addSuffix: true, locale: sv })
                : 'Okänd'}
            </span>
          </div>

          {/* Last Sync */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Senaste synkronisering</span>
            </div>
            <span className="text-xs">
              {lastSync 
                ? formatDistanceToNow(new Date(lastSync), { addSuffix: true, locale: sv })
                : 'Okänd'}
            </span>
          </div>
        </div>

        {isAuthenticated && <div className="space-y-3 py-3 border-t">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="target-temp" className="text-sm font-semibold">
                Ändra måltemperatur
              </Label>
              <span className="text-xl font-bold text-primary">
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
              className="py-2"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
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
        </div>}

        {!isAuthenticated && (
          <div className="bg-muted/50 p-3 rounded-lg flex items-center gap-2 border-t">
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
    </Dialog>
  );
}
