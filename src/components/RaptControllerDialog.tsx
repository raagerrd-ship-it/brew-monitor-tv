import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useNavigate } from 'react-router-dom';
import { Loader2, Thermometer, Clock, RefreshCw, Lock, Flame, Snowflake, Pencil } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { sv } from 'date-fns/locale';
import { ControllerTempChart } from './controller-chart';
import { FermentationSessionMinimal } from './fermentation/FermentationSessionMinimal';
import { PiRemoteControl } from './PiRemoteControl';
import { DEFAULT_DEVICE_COLOR } from '@/lib/brew-utils';
import { useControllerDialog } from '@/hooks';
import { getDisplayTarget } from '@/lib/temp-display';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface TempController {
  id: string;
  controller_id: string;
  name: string;
  current_temp: number | null;
  pill_temp: number | null;
  actual_temp: number | null;
  target_temp: number | null;
  last_update: string | null;
  min_target_temp: number | null;
  max_target_temp: number | null;
  cooling_enabled: boolean | null;
  heating_enabled: boolean | null;
  heating_utilisation: number | null;
  cooling_hysteresis: number | null;
  heating_hysteresis: number | null;
  cooling_run_time: number | null;
  cooling_starts: number | null;
  heating_run_time: number | null;
  heating_starts: number | null;
}

interface RaptControllerDialogProps {
  controller: TempController;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isCooler?: boolean;
  controllerColor?: string;
}

export function RaptControllerDialog({ controller, open, onOpenChange, isCooler = false, controllerColor = DEFAULT_DEVICE_COLOR }: RaptControllerDialogProps) {
  const navigate = useNavigate();

  const {
    loading, isAuthenticated, targetTemp, setTargetTemp,
    lastSync, currentController, hasActiveSession,
    showTempAdjust, setShowTempAdjust, setTargetTemperature,
    isActivelyCooling, isActivelyHeating, originalTarget,
    dutyCyclePct, dutyMode,
    isPi, piHeartbeat, hasPiLive, piTarget,
  } = useControllerDialog({ controller, open, onOpenChange });

  const isPillCompActive = !isCooler && currentController.pill_temp != null && currentController.current_temp != null;

  // PID-motor: 'v5' (nuvarande) eller 'claude' (V6 feedforward+P+D)
  const [pidVersion, setPidVersion] = useState<'v5' | 'claude'>('v5');
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('rapt_temp_controllers')
        .select('pid_version')
        .eq('controller_id', controller.controller_id)
        .maybeSingle();
      if (!cancelled && (data as any)?.pid_version) {
        setPidVersion((data as any).pid_version === 'claude' ? 'claude' : 'v5');
      }
    })();
    return () => { cancelled = true; };
  }, [open, controller.controller_id]);
  const updatePidVersion = async (v: 'v5' | 'claude') => {
    setPidVersion(v);
    await supabase
      .from('rapt_temp_controllers')
      .update({ pid_version: v } as any)
      .eq('controller_id', controller.controller_id);
  };
  // SSOT: actual_temp kommer från Pi:n (snittet den reglerar mot).
  const actualTemp = currentController.actual_temp
    ?? currentController.current_temp
    ?? currentController.pill_temp;
  const { actualTarget: raptTarget } = getDisplayTarget(originalTarget, currentController.target_temp);
  const actualTarget = isPi ? piTarget : raptTarget;

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
          {/* Minimal Fermentation Session Status */}
          {!isCooler && <FermentationSessionMinimal controllerId={controller.controller_id} />}

          {/* Fjärrstyrning — Pi:n är master, molnet uttrycker avsikt */}
          {isAuthenticated && isPi && !isCooler && (
            <PiRemoteControl
              controllerId={controller.controller_id}
              controllerName={controller.name}
              minTemp={currentController.min_target_temp}
              maxTemp={currentController.max_target_temp}
              currentTarget={actualTarget}
            />
          )}

          {/* PID-motor toggle */}
          {isAuthenticated && !isCooler && !isPi && (
            <div className="bg-muted/30 backdrop-blur-sm rounded-xl p-3 border border-border/30">
              <div className="flex items-center justify-between gap-3">
                <Label className="text-xs text-muted-foreground">PID-motor</Label>
                <div className="inline-flex rounded-lg bg-muted/50 p-0.5 border border-border/30">
                  <button
                    type="button"
                    onClick={() => updatePidVersion('v5')}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                      pidVersion === 'v5' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    V5
                  </button>
                  <button
                    type="button"
                    onClick={() => updatePidVersion('claude')}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                      pidVersion === 'claude' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Claude
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Temperature Stats Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-muted/30 backdrop-blur-sm rounded-xl p-4 border border-border/30">
              <p className="text-xs text-muted-foreground mb-1">Aktuell</p>
              <p className="text-2xl font-bold tabular-nums" style={{ color: controllerColor }}>
                {actualTemp !== null ? `${actualTemp.toFixed(1)}°` : '—'}
              </p>
              <p className="text-[10px] text-muted-foreground/70 mt-1">
                {isPillCompActive
                  ? `Medel · Probe: ${currentController.current_temp?.toFixed(1)}° · Pill: ${currentController.pill_temp?.toFixed(1)}°`
                  : currentController.pill_temp != null
                    ? `Pill: ${currentController.pill_temp.toFixed(1)}°`
                    : 'PT100-sensor'}
              </p>
            </div>
            
            <div 
              className={`bg-muted/30 backdrop-blur-sm rounded-xl p-4 border border-border/30 transition-all ${
                isAuthenticated && !hasActiveSession && !isCooler ? 'cursor-pointer hover:bg-muted/50 hover:border-primary/30' : ''
              }`}
              onClick={() => {
                if (isAuthenticated && !hasActiveSession && !isCooler) {
                  setShowTempAdjust(!showTempAdjust);
                }
              }}
            >
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-muted-foreground">Mål</p>
                {isAuthenticated && !hasActiveSession && !isCooler && (
                  <Pencil className="w-3 h-3 text-muted-foreground/50" />
                )}
              </div>
              <p className="text-2xl font-bold tabular-nums text-primary">
                {actualTarget !== null ? `${actualTarget.toFixed(1)}°` : '—'}
              </p>
              {dutyCyclePct != null ? (
                <p className="text-[10px] text-muted-foreground/70 mt-1">
                  PWM {Math.round(dutyCyclePct)}% {dutyMode === 'cooling' ? '❄️' : dutyMode === 'heating' ? '🔥' : ''}
                </p>
              ) : !isCooler && currentController.pill_temp != null && !isPillCompActive ? (
                <p className="text-[10px] text-muted-foreground/70 mt-1">
                  Pill: {currentController.pill_temp.toFixed(1)}°
                </p>
              ) : null}
              {isCooler && (
                <p className="text-[10px] text-muted-foreground/70 mt-1">
                  Härleds av Pi:n
                </p>
              )}
            </div>
          </div>

          {/* Temperature adjustment */}
          {isAuthenticated && showTempAdjust && !hasActiveSession && !isCooler && (
            <div className="space-y-3 p-3 bg-muted/20 rounded-xl border border-border/30 animate-fade-in">
              <div className="flex items-center justify-between">
                <Label htmlFor="target-temp" className="text-xs font-medium text-muted-foreground">
                  Ändra mål
                </Label>
                <span className="text-lg font-bold text-primary tabular-nums">
                  {targetTemp}°
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
                <span>{currentController.min_target_temp ?? -5}°</span>
                <span>{currentController.max_target_temp ?? 25}°</span>
              </div>
              <Button 
                onClick={setTargetTemperature} 
                disabled={loading}
                className="w-full"
                size="sm"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Sätt mål'}
              </Button>
            </div>
          )}

          {/* Givarval sker lokalt på Pi:n (use_pt100 / use_pill i tank_map.json) */}
          {/* Heating/Cooling Status */}
          <div className="flex gap-2">
            {!isCooler && <div className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg transition-all ${
              isActivelyHeating 
                ? 'bg-orange-500/15 border border-orange-500/30' 
                : 'bg-muted/20 border border-border/20'
            }`}>
              <Flame className={`w-4 h-4 ${isActivelyHeating ? 'text-orange-500' : 'text-muted-foreground/40'}`} />
              {isActivelyHeating && <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />}
              <span className={`text-xs font-medium ${
                isActivelyHeating ? 'text-orange-600 dark:text-orange-400' : 'text-muted-foreground/60'
              }`}>
                {!isPi && !currentController.heating_enabled ? 'Inaktiv' : isActivelyHeating ? 'Värmer' : 'Standby'}
              </span>
            </div>}
            
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
                {!isPi && !currentController.cooling_enabled ? 'Inaktiv' : isActivelyCooling ? 'Kyler' : 'Standby'}
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
            {(!isPi || hasPiLive) && <div className="flex items-center gap-1.5">
              <RefreshCw className="w-3 h-3" />
              <span>{isPi ? 'Pi' : 'Synk'}: {(isPi ? piHeartbeat : lastSync)
                ? formatDistanceToNow(new Date((isPi ? piHeartbeat : lastSync) as string), { addSuffix: true, locale: sv })
                : '—'}</span>
            </div>}
          </div>

          {/* Temperature Chart */}
          <div className="bg-muted/20 backdrop-blur-sm rounded-xl p-4 border border-border/30">
            <ControllerTempChart 
              controllerId={controller.controller_id} 
              controllerColor={controllerColor}
              coolingOnly={isCooler}
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
    </Dialog>
  );
}
