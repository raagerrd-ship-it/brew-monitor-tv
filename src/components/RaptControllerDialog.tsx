import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Thermometer, Settings } from 'lucide-react';

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
  const [targetTemp, setTargetTemp] = useState(controller.target_temp?.toString() || '12');
  const [pidEnabled, setPidEnabled] = useState(true);
  const [pidP, setPidP] = useState('8.0');
  const [pidI, setPidI] = useState('0.002');
  const [pidD, setPidD] = useState('2.0');

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

  const handleSetPIDEnabled = async (enabled: boolean) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('rapt-update-controller', {
        body: {
          controllerId: controller.controller_id,
          action: 'setPIDEnabled',
          value: enabled
        }
      });

      if (error) throw error;

      // Check if the response contains an error
      if (data?.error) {
        throw new Error(data.error);
      }

      setPidEnabled(enabled);
      toast({
        title: "PID-kontroll uppdaterad",
        description: `PID-kontroll är nu ${enabled ? 'aktiverad' : 'inaktiverad'}`,
      });
    } catch (error) {
      console.error('Error updating PID enabled:', error);
      const errorMessage = error instanceof Error ? error.message : "Kunde inte uppdatera PID-kontroll";
      
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

  const handleSetPID = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('rapt-update-controller', {
        body: {
          controllerId: controller.controller_id,
          action: 'setPID',
          value: {
            proportionalGain: parseFloat(pidP),
            integralTime: parseFloat(pidI),
            derivativeTime: parseFloat(pidD)
          }
        }
      });

      if (error) throw error;

      // Check if the response contains an error
      if (data?.error) {
        throw new Error(data.error);
      }

      toast({
        title: "PID-parametrar uppdaterade",
        description: `P=${pidP}, I=${pidI}, D=${pidD}`,
      });
    } catch (error) {
      console.error('Error updating PID parameters:', error);
      const errorMessage = error instanceof Error ? error.message : "Kunde inte uppdatera PID-parametrar";
      
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
          <DialogDescription>
            Nuvarande temperatur: {controller.current_temp !== null ? `${controller.current_temp.toFixed(1)}°C` : 'Okänd'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Target Temperature */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="target-temp" className="text-base font-semibold">
                Måltemperatur
              </Label>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  id="target-temp"
                  type="number"
                  step="0.1"
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
              Ställ in önskad måltemperatur för temperaturstyrt jäsning
            </p>
          </div>

          <Separator />

          {/* PID Control */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-primary" />
                <Label htmlFor="pid-enabled" className="text-base font-semibold cursor-pointer">
                  PID-kontroll
                </Label>
              </div>
              <Switch
                id="pid-enabled"
                checked={pidEnabled}
                onCheckedChange={handleSetPIDEnabled}
                disabled={loading}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Aktivera avancerad PID-temperaturreglering för exakt kontroll
            </p>

            {pidEnabled && (
              <div className="space-y-3 pt-2">
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="pid-p" className="text-sm">P (Proportional)</Label>
                    <Input
                      id="pid-p"
                      type="number"
                      step="0.1"
                      value={pidP}
                      onChange={(e) => setPidP(e.target.value)}
                      disabled={loading}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pid-i" className="text-sm">I (Integral)</Label>
                    <Input
                      id="pid-i"
                      type="number"
                      step="0.001"
                      value={pidI}
                      onChange={(e) => setPidI(e.target.value)}
                      disabled={loading}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pid-d" className="text-sm">D (Derivative)</Label>
                    <Input
                      id="pid-d"
                      type="number"
                      step="0.1"
                      value={pidD}
                      onChange={(e) => setPidD(e.target.value)}
                      disabled={loading}
                    />
                  </div>
                </div>
                <Button 
                  onClick={handleSetPID} 
                  disabled={loading}
                  variant="outline"
                  className="w-full"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Uppdatera PID-parametrar
                </Button>
                <p className="text-xs text-muted-foreground">
                  Standard: P=8.0, I=0.002, D=2.0. Justera försiktigt för optimal prestanda.
                </p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
