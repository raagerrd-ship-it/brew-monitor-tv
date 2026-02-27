import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { useNavigate } from 'react-router-dom';
import { Loader2, Thermometer, Clock, RefreshCw, Lock, Flame, Snowflake, Plus, Pencil } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { sv } from 'date-fns/locale';
import { ControllerTempChart } from './controller-chart';
import { StartFermentationSessionDialog, ActiveFermentationSession } from './fermentation';
import { getControllerColor } from '@/lib/brew-utils';
import { useControllerDialog } from '@/hooks/use-controller-dialog';

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
}

export function RaptControllerDialog({ controller, open, onOpenChange, isCooler = false }: RaptControllerDialogProps) {
  const navigate = useNavigate();
  const [showStartSessionDialog, setShowStartSessionDialog] = useState(false);
  const controllerColor = getControllerColor(controller.name);

  const {
    loading, isAuthenticated, targetTemp, setTargetTemp,
    lastSync, currentController, hasActiveSession,
    showTempAdjust, setShowTempAdjust, setTargetTemperature,
    isActivelyCooling, isActivelyHeating,
  } = useControllerDialog({ controller, open, onOpenChange });

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

          {/* Temperature Stats Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-muted/30 backdrop-blur-sm rounded-xl p-4 border border-border/30">
              <p className="text-xs text-muted-foreground mb-1">Aktuell temp</p>
              <p className="text-2xl font-bold tabular-nums" style={{ color: controllerColor }}>
                {currentController.current_temp !== null ? `${currentController.current_temp.toFixed(1)}°` : '—'}
              </p>
              <p className="text-[10px] text-muted-foreground/70 mt-1">Inbyggd sensor</p>
            </div>
            
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
                  Pill: {currentController.pill_temp.toFixed(1)}°
                </p>
              )}
            </div>
          </div>

          {/* Temperature adjustment */}
          {isAuthenticated && showTempAdjust && !hasActiveSession && (
            <div className="space-y-3 p-3 bg-muted/20 rounded-xl border border-border/30 animate-fade-in">
              <div className="flex items-center justify-between">
                <Label htmlFor="target-temp" className="text-xs font-medium text-muted-foreground">
                  Ändra måltemperatur
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
            
        {/* Start Profile Button */}
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
