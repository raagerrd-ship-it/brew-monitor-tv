import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Loader2, Power, Hand, Play } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { sv } from 'date-fns/locale';
import { usePiRemoteControl } from '@/hooks/use-pi-remote-control';
import { useToast } from '@/hooks/use-toast';

interface PiRemoteControlProps {
  controllerId: string;
  controllerName: string;
  minTemp?: number | null;
  maxTemp?: number | null;
  currentTarget?: number | null;
}

export function PiRemoteControl({
  controllerId, controllerName, minTemp, maxTemp, currentTarget,
}: PiRemoteControlProps) {
  const { toast } = useToast();
  const remote = usePiRemoteControl(controllerId);
  const [temp, setTemp] = useState<number>(currentTarget != null ? Math.round(currentTarget * 2) / 2 : 12);
  const [confirmOff, setConfirmOff] = useState(false);

  // "Av" vinner alltid över "manuellt" i visningen.
  const source = remote.enabled === false ? 'off' : remote.targetSource;

  const run = async (fn: () => Promise<void>, msg: string) => {
    try {
      await fn();
      toast({ title: 'Skickat till Pi', description: msg });
    } catch (e) {
      toast({ title: 'Kunde inte skicka', description: 'Kommandot nådde inte fram.', variant: 'destructive' });
    }
  };

  return (
    <div className="bg-muted/30 backdrop-blur-sm rounded-xl p-3 border border-border/30 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs text-muted-foreground">Fjärrstyrning</Label>
        <span className="text-[10px] text-muted-foreground/70">
          {remote.pending
            ? 'Skickat — väntar på Pi:n…'
            : remote.commandedAt
              ? `Kvitterat ${formatDistanceToNow(new Date(remote.commandedAt), { addSuffix: true, locale: sv })}`
              : 'Pi:n är master'}
        </span>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span className={`px-2 py-0.5 rounded-md font-medium ${
          source === 'off' ? 'bg-destructive/15 text-destructive'
            : source === 'manual' ? 'bg-amber-500/15 text-amber-500'
            : 'bg-muted/50 text-muted-foreground'
        }`}>
          {source === 'off' ? 'Avstängd' : source === 'manual' ? 'Manuellt läge' : 'Profilstyrd'}
        </span>
        {remote.effectiveTarget != null && (
          <span className="tabular-nums text-muted-foreground">Mål {remote.effectiveTarget.toFixed(1)}°</span>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Manuellt mål</Label>
          <span className="text-sm font-bold text-primary tabular-nums">{temp.toFixed(1)}°</span>
        </div>
        <Slider
          min={minTemp ?? -5}
          max={maxTemp ?? 25}
          step={0.5}
          value={[temp]}
          onValueChange={(v) => setTemp(v[0])}
          disabled={remote.sending}
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            className="flex-1"
            disabled={remote.sending}
            onClick={() => run(() => remote.setManualTarget(temp), `${controllerName}: manuellt mål ${temp.toFixed(1)}° (profilen pausas)`)}
          >
            {remote.sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Hand className="w-3.5 h-3.5 mr-1" />Sätt manuellt</>}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            disabled={remote.sending || source === 'profile'}
            onClick={() => run(() => remote.releaseToProfile(), `${controllerName}: tillbaka till profilstyrning`)}
          >
            <Play className="w-3.5 h-3.5 mr-1" />Återgå
          </Button>
        </div>
      </div>

      <div className="pt-1 border-t border-border/30">
        {remote.enabled === false ? (
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            disabled={remote.sending}
            onClick={() => run(() => remote.setEnabled(true), `${controllerName}: reglering på`)}
          >
            <Power className="w-3.5 h-3.5 mr-1" />Slå på reglering
          </Button>
        ) : confirmOff ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              className="flex-1"
              disabled={remote.sending}
              onClick={() => { setConfirmOff(false); run(() => remote.setEnabled(false), `${controllerName}: reglering av`); }}
            >
              Ja, stäng av
            </Button>
            <Button size="sm" variant="ghost" className="flex-1" onClick={() => setConfirmOff(false)}>Avbryt</Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" className="w-full text-destructive" onClick={() => setConfirmOff(true)}>
            <Power className="w-3.5 h-3.5 mr-1" />Stäng av reglering
          </Button>
        )}
      </div>
    </div>
  );
}
