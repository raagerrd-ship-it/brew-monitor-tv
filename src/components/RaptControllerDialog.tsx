import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Thermometer, Clock, RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { sv } from 'date-fns/locale';

interface TempController {
  id: string;
  controller_id: string;
  name: string;
  current_temp: number | null;
  target_temp: number | null;
  last_update: string | null;
}

interface RaptControllerDialogProps {
  controller: TempController;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RaptControllerDialog({ controller, open, onOpenChange }: RaptControllerDialogProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [targetTemp, setTargetTemp] = useState(controller.target_temp !== null ? Math.round(controller.target_temp).toString() : '12');
  const [lastSync, setLastSync] = useState<string | null>(null);

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
    }
  }, [open]);

  const handleSetTargetTemperature = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('rapt-update-controller', {
        body: {
          controllerId: controller.controller_id,
          action: 'setTargetTemperature',
          value: parseFloat(targetTemp)
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
      <DialogContent className="sm:max-w-[500px] bg-background border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Thermometer className="w-5 h-5 text-primary" />
            {controller.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Current Temperature */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2">
              <Thermometer className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Nuvarande temperatur</span>
            </div>
            <span className="text-lg font-semibold">
              {controller.current_temp !== null ? `${controller.current_temp.toFixed(1)}°C` : 'Okänd'}
            </span>
          </div>

          {/* Target Temperature Display */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2">
              <Thermometer className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Måltemperatur</span>
            </div>
            <span className="text-lg font-semibold">
              {controller.target_temp !== null ? `${controller.target_temp.toFixed(1)}°C` : 'Ej satt'}
            </span>
          </div>

          {/* Last Update */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Senaste data</span>
            </div>
            <span className="text-sm">
              {controller.last_update 
                ? formatDistanceToNow(new Date(controller.last_update), { addSuffix: true, locale: sv })
                : 'Okänd'}
            </span>
          </div>

          {/* Last Sync */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Senaste synkronisering</span>
            </div>
            <span className="text-sm">
              {lastSync 
                ? formatDistanceToNow(new Date(lastSync), { addSuffix: true, locale: sv })
                : 'Okänd'}
            </span>
          </div>
        </div>

        <div className="space-y-4 py-4 border-t">
          {/* Target Temperature Input */}
          <div className="space-y-3">
            <Label htmlFor="target-temp" className="text-base font-semibold">
              Ändra måltemperatur
            </Label>
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  id="target-temp"
                  type="number"
                  min="-5"
                  max="25"
                  step="1"
                  value={targetTemp}
                  onChange={(e) => setTargetTemp(e.target.value)}
                  className="text-lg"
                  disabled={loading}
                />
              </div>
              <Button 
                onClick={handleSetTargetTemperature} 
                disabled={loading}
                className="min-w-[100px]"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Sätt'}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Ställ in önskad måltemperatur (-5°C till +25°C) för temperaturstyrt jäsning
            </p>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}
