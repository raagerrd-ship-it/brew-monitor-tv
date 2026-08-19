import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Loader2, Power, Hand, Play, Cpu, ChevronDown } from 'lucide-react';
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
  const touched = useRef(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // "Av" vinner alltid över "manuellt" i visningen.
  const source = remote.enabled === false ? 'off' : remote.targetSource;
  const isRemote = source === 'manual' || source === 'off';
  const showControls = isRemote || expanded;
  const shownTarget = remote.effectiveTarget ?? remote.piTarget ?? currentTarget ?? null;

  const commandedTarget = remote.commandedTarget;
  const commandedEnabled = remote.commandedEnabled;
  const isPending = remote.pending;
  const targetWillChange = isPending && commandedTarget != null && shownTarget != null && Math.abs(commandedTarget - shownTarget) >= 0.1;
  const releasingToProfile = isPending && commandedTarget == null && source === 'manual';
  const turningOff = isPending && commandedEnabled === false;
  const anyPending = isPending && (targetWillChange || releasingToProfile || turningOff || commandedTarget != null);

  // Följ Pi:ns verkliga mål tills användaren själv rört reglaget.
  useEffect(() => {
    if (!touched.current && shownTarget != null) setTemp(Math.round(shownTarget * 2) / 2);
  }, [shownTarget]);


  const statusStyle = source === 'off'
    ? { hue: '0 72% 55%', title: 'AVSTÄNGD', sub: 'Fjärrstyrd av dig — ingen reglering' }
    : source === 'manual'
      ? { hue: '38 92% 55%', title: 'MANUELLT MÅL', sub: 'Fjärrstyrd av dig · profilen pausad' }
      : { hue: '150 55% 48%', title: 'PI:N STYR', sub: 'Profilen kör lokalt på Pi:n' };

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
          {anyPending
            ? 'Skickat — väntar på Pi:n…'
            : remote.commandedAt
              ? `Kvitterat ${formatDistanceToNow(new Date(remote.commandedAt), { addSuffix: true, locale: sv })}`
              : 'Pi:n är master'}
        </span>
      </div>

      <div
        className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-opacity"
        style={{
          background: `hsl(${statusStyle.hue} / 0.12)`,
          border: `1px solid hsl(${statusStyle.hue} / 0.45)`,
          opacity: anyPending ? 0.7 : 1,
          animation: anyPending ? 'pulse-border 1.5s ease-in-out infinite' : undefined,
        }}
      >
        <style>{`
          @keyframes pulse-border {
            0%, 100% { box-shadow: 0 0 0 0 hsl(${statusStyle.hue} / 0.35); }
            50% { box-shadow: 0 0 0 4px hsl(${statusStyle.hue} / 0); }
          }
        `}</style>
        <div
          className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: `hsl(${statusStyle.hue} / 0.18)` }}
        >
          {anyPending
            ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: `hsl(${statusStyle.hue})` }} />
            : source === 'off'
            ? <Power className="w-4 h-4" style={{ color: `hsl(${statusStyle.hue})` }} />
            : source === 'manual'
              ? <Hand className="w-4 h-4" style={{ color: `hsl(${statusStyle.hue})` }} />
              : <Cpu className="w-4 h-4" style={{ color: `hsl(${statusStyle.hue})` }} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold tracking-wide truncate" style={{ color: `hsl(${statusStyle.hue})` }}>
            {statusStyle.title}
          </div>
          <div className="text-[11px] text-muted-foreground truncate">
            {anyPending
              ? (releasingToProfile
                ? 'Väntar på Pi:n — återgår till profilstyrning…'
                : turningOff
                  ? 'Väntar på Pi:n — stänger av reglering…'
                  : `Väntar på Pi:n — byter mål till ${commandedTarget?.toFixed(1) ?? '?'}°…`)
              : statusStyle.sub}
            {isRemote && remote.pausedAt && !anyPending
              ? ` · ${formatDistanceToNow(new Date(remote.pausedAt), { addSuffix: true, locale: sv })}`
              : ''}
          </div>
        </div>
        {source !== 'off' && shownTarget != null && (
          <div className="shrink-0 text-right leading-tight">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {anyPending ? 'Byter till' : 'Reglerar mot'}
            </div>
            <div className="text-base font-bold tabular-nums" style={{ color: `hsl(${statusStyle.hue})` }}>
              {targetWillChange
                ? `${shownTarget.toFixed(1)}° → ${commandedTarget?.toFixed(1)}°`
                : `${shownTarget.toFixed(1)}°`}
            </div>
          </div>
        )}
      </div>


      {!showControls && (
        <Button size="sm" variant="outline" className="w-full" onClick={() => setExpanded(true)}>
          <Hand className="w-3.5 h-3.5 mr-1" />Ta över manuellt
        </Button>
      )}

      {showControls && (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Nytt manuellt mål</Label>
          <span className="text-sm font-bold text-primary tabular-nums">{temp.toFixed(1)}°</span>
        </div>
        <Slider
          min={minTemp ?? -5}
          max={maxTemp ?? 25}
          step={0.5}
          value={[temp]}
          onValueChange={(v) => { touched.current = true; setTemp(v[0]); }}
          disabled={remote.sending}
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            className="flex-1"
            disabled={remote.sending}
            onClick={() => run(() => remote.setManualTarget(temp), `${controllerName}: manuellt mål ${temp.toFixed(1)}° (profilen pausas)`)}
          >
            {remote.sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Hand className="w-3.5 h-3.5 mr-1" />Sätt {temp.toFixed(1)}°</>}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            disabled={remote.sending || source === 'profile'}
            onClick={() => run(() => remote.releaseToProfile(), `${controllerName}: tillbaka till profilstyrning`)}
          >
            <Play className="w-3.5 h-3.5 mr-1" />Återgå till profil
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground/80">
          {source === 'profile'
            ? 'Sätter du ett manuellt mål pausas profilen tills du återgår.'
            : 'Profilen är pausad — “Återgå till profil” lämnar tillbaka styrningen till Pi:n.'}
        </p>
      </div>
      )}

      {showControls && (
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
      )}

      {showControls && !isRemote && (
        <Button size="sm" variant="ghost" className="w-full text-muted-foreground" onClick={() => setExpanded(false)}>
          <ChevronDown className="w-3.5 h-3.5 mr-1 rotate-180" />Dölj
        </Button>
      )}
    </div>
  );
}
