import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Loader2, Power, Hand, Cpu, Minus, Plus, Check } from 'lucide-react';
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

type Mode = 'profile' | 'manual' | 'off';

const MODES: { key: Mode; label: string; hue: string; icon: typeof Cpu }[] = [
  { key: 'profile', label: 'Profil', hue: '150 55% 48%', icon: Cpu },
  { key: 'manual', label: 'Manuellt', hue: '38 92% 55%', icon: Hand },
  { key: 'off', label: 'Av', hue: '0 72% 55%', icon: Power },
];

export function PiRemoteControl({
  controllerId, controllerName, minTemp, maxTemp, currentTarget,
}: PiRemoteControlProps) {
  const { toast } = useToast();
  const remote = usePiRemoteControl(controllerId);
  const [temp, setTemp] = useState<number>(currentTarget != null ? Math.round(currentTarget * 2) / 2 : 12);
  const touched = useRef(false);
  const [draftMode, setDraftMode] = useState<Mode | null>(null);

  const min = minTemp ?? -5;
  const max = maxTemp ?? 25;

  // "Av" vinner alltid över "manuellt" i visningen.
  const activeMode: Mode = remote.enabled === false ? 'off' : (remote.targetSource === 'manual' ? 'manual' : 'profile');
  const shownTarget = remote.effectiveTarget ?? remote.piTarget ?? currentTarget ?? null;

  const commandedTarget = remote.commandedTarget;
  const commandedEnabled = remote.commandedEnabled;
  const isPending = remote.pending;
  const targetWillChange = isPending && commandedTarget != null && shownTarget != null && Math.abs(commandedTarget - shownTarget) >= 0.1;
  const releasingToProfile = isPending && commandedTarget == null && activeMode === 'manual';
  const turningOff = isPending && commandedEnabled === false;
  const anyPending = isPending && (targetWillChange || releasingToProfile || turningOff || commandedTarget != null);

  // Vilket läge panelen visar: användarens val om det finns, annars Pi:ns.
  const viewMode: Mode = draftMode ?? activeMode;
  const modeMeta = MODES.find((m) => m.key === viewMode)!;
  const isDraft = draftMode != null && draftMode !== activeMode;

  // Följ Pi:ns verkliga mål tills användaren själv rört reglaget.
  useEffect(() => {
    if (!touched.current && shownTarget != null) setTemp(Math.round(shownTarget * 2) / 2);
  }, [shownTarget]);

  // Släpp utkastet när Pi:n kvitterat samma läge.
  useEffect(() => {
    if (draftMode != null && draftMode === activeMode) setDraftMode(null);
  }, [draftMode, activeMode]);

  const targetDiffers = activeMode === 'manual' && shownTarget != null && Math.abs(temp - shownTarget) >= 0.05;
  const needsApply = isDraft || (viewMode === 'manual' && targetDiffers);

  const run = async (fn: () => Promise<void>, msg: string) => {
    try {
      await fn();
      toast({ title: 'Skickat till Pi', description: msg });
    } catch {
      toast({ title: 'Kunde inte skicka', description: 'Kommandot nådde inte fram.', variant: 'destructive' });
    }
  };

  const apply = async () => {
    if (viewMode === 'off') {
      await run(() => remote.setEnabled(false), `${controllerName}: reglering av`);
      return;
    }
    if (viewMode === 'profile') {
      if (remote.enabled === false) await remote.setEnabled(true);
      await run(() => remote.releaseToProfile(), `${controllerName}: tillbaka till profilstyrning`);
      return;
    }
    if (remote.enabled === false) await remote.setEnabled(true);
    await run(() => remote.setManualTarget(temp), `${controllerName}: manuellt mål ${temp.toFixed(1)}°`);
  };

  const nudge = (d: number) => {
    touched.current = true;
    setTemp((t) => Math.min(max, Math.max(min, Math.round((t + d) * 2) / 2)));
  };

  const statusLine = anyPending
    ? (releasingToProfile
      ? 'Väntar på Pi:n — återgår till profilstyrning…'
      : turningOff
        ? 'Väntar på Pi:n — stänger av reglering…'
        : `Väntar på Pi:n — byter mål till ${commandedTarget?.toFixed(1) ?? '?'}°…`)
    : activeMode === 'off'
      ? 'Ingen reglering — fjärrstyrd av dig'
      : activeMode === 'manual'
        ? 'Manuellt mål — profilen är pausad'
        : 'Profilen kör lokalt på Pi:n';

  return (
    <div className="rounded-xl border border-border/30 bg-muted/20 backdrop-blur-sm overflow-hidden">
      <style>{`
        @keyframes pi-pulse { 0%,100% { opacity: 1 } 50% { opacity: .45 } }
      `}</style>

      {/* Aktuellt läge — stor, otvetydig annunciator */}
      <div
        className="px-4 pt-4 pb-3.5 flex items-center gap-3"
        style={{ background: `linear-gradient(to bottom, hsl(${modeMeta.hue} / 0.14), transparent)` }}
      >
        <div
          className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: `hsl(${modeMeta.hue} / 0.16)`, border: `1px solid hsl(${modeMeta.hue} / 0.35)` }}
        >
          {anyPending
            ? <Loader2 className="w-5 h-5 animate-spin" style={{ color: `hsl(${modeMeta.hue})` }} />
            : <modeMeta.icon className="w-5 h-5" style={{ color: `hsl(${modeMeta.hue})` }} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground/70">Styrning</div>
          <div className="text-sm font-bold tracking-wide truncate" style={{ color: `hsl(${MODES.find(m => m.key === activeMode)!.hue})` }}>
            {activeMode === 'off' ? 'AVSTÄNGD' : activeMode === 'manual' ? 'MANUELLT MÅL' : 'PI:N STYR'}
          </div>
          <div
            className="text-[11px] text-muted-foreground truncate"
            style={{ animation: anyPending ? 'pi-pulse 1.4s ease-in-out infinite' : undefined }}
          >
            {statusLine}
          </div>
        </div>
        {activeMode !== 'off' && shownTarget != null && (
          <div className="shrink-0 text-right leading-none">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
              {targetWillChange ? 'Byter till' : 'Reglerar mot'}
            </div>
            <div className="text-2xl font-bold tabular-nums" style={{ color: `hsl(${MODES.find(m => m.key === activeMode)!.hue})` }}>
              {(targetWillChange ? commandedTarget! : shownTarget).toFixed(1)}°
            </div>
          </div>
        )}
      </div>

      {/* Lägesväljare */}
      <div className="px-4">
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-background/50 p-1 border border-border/30">
          {MODES.map((m) => {
            const selected = viewMode === m.key;
            const live = activeMode === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => setDraftMode(m.key === activeMode ? null : m.key)}
                disabled={remote.sending}
                className="relative flex items-center justify-center gap-1.5 rounded-md py-2 text-xs font-semibold transition-colors disabled:opacity-50"
                style={selected
                  ? { background: `hsl(${m.hue} / 0.18)`, color: `hsl(${m.hue})`, boxShadow: `inset 0 0 0 1px hsl(${m.hue} / 0.45)` }
                  : { color: 'hsl(var(--muted-foreground))' }}
              >
                <m.icon className="w-3.5 h-3.5" />
                {m.label}
                {live && !selected && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full" style={{ background: `hsl(${m.hue})` }} />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Målinställning — bara i manuellt läge */}
      {viewMode === 'manual' && (
        <div className="px-4 pt-4">
          <div className="flex items-center gap-3">
            <Button
              variant="outline" size="icon" className="h-11 w-11 shrink-0"
              onClick={() => nudge(-0.5)} disabled={remote.sending || temp <= min}
              aria-label="Sänk mål"
            >
              <Minus className="w-4 h-4" />
            </Button>
            <div className="flex-1 text-center leading-none">
              <div className="text-4xl font-bold tabular-nums" style={{ color: 'hsl(38 92% 55%)' }}>
                {temp.toFixed(1)}°
              </div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1.5">Nytt mål</div>
            </div>
            <Button
              variant="outline" size="icon" className="h-11 w-11 shrink-0"
              onClick={() => nudge(0.5)} disabled={remote.sending || temp >= max}
              aria-label="Höj mål"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>
          <div className="mt-3">
            <Slider
              min={min} max={max} step={0.5} value={[temp]}
              onValueChange={(v) => { touched.current = true; setTemp(v[0]); }}
              disabled={remote.sending}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground/70 mt-1 tabular-nums">
              <span>{min.toFixed(0)}°</span>
              <span>{max.toFixed(0)}°</span>
            </div>
          </div>
        </div>
      )}

      {/* Förklaring + bekräfta */}
      <div className="p-4 pt-3 space-y-2">
        <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
          {viewMode === 'profile'
            ? 'Pi:n följer den aktiva jäsprofilen och sköter all reglering själv.'
            : viewMode === 'manual'
              ? 'Ett manuellt mål pausar profilen tills du väljer Profil igen.'
              : 'Reglering stängs av helt — varken kyla eller värme körs.'}
        </p>

        {needsApply && (
          <Button
            className="w-full h-11 font-semibold"
            variant={viewMode === 'off' ? 'destructive' : 'default'}
            disabled={remote.sending}
            onClick={apply}
          >
            {remote.sending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <>
                  <Check className="w-4 h-4 mr-1.5" />
                  {viewMode === 'off'
                    ? 'Bekräfta — stäng av reglering'
                    : viewMode === 'profile'
                      ? 'Lämna tillbaka till profilen'
                      : `Sätt ${temp.toFixed(1)}°`}
                </>}
          </Button>
        )}

        {isDraft && (
          <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => setDraftMode(null)}>
            Avbryt
          </Button>
        )}

        <div className="text-[10px] text-muted-foreground/60 text-center pt-0.5">
          {anyPending
            ? 'Skickat — väntar på Pi:ns kvittens…'
            : remote.commandedAt
              ? `Senast kvitterat ${formatDistanceToNow(new Date(remote.commandedAt), { addSuffix: true, locale: sv })}`
              : 'Pi:n är master — molnet skickar bara önskemål'}
        </div>
      </div>
    </div>
  );
}
