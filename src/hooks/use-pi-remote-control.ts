import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type TargetSource = 'profile' | 'manual' | 'off' | null;

export interface PiRemoteState {
  targetSource: TargetSource;
  effectiveTarget: number | null;
  pausedAt: string | null;
  enabled: boolean | null;
  lastHeartbeat: string | null;
}

/**
 * Fjärrkontroll mot Pi:n. Molnet uttrycker bara AVSIKT i pi_setpoint;
 * Pi:n är master och ekar tillbaka target_source/effective_target i pi_live_state.
 */
export function usePiRemoteControl(controllerId: string, active = true) {
  const [state, setState] = useState<PiRemoteState>({
    targetSource: null, effectiveTarget: null, pausedAt: null, enabled: null, lastHeartbeat: null,
  });
  const [commandedAt, setCommandedAt] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!active || !controllerId) return;
    let cancelled = false;

    const apply = (row: any) => {
      if (!row || cancelled) return;
      setState({
        targetSource: (row.target_source ?? null) as TargetSource,
        effectiveTarget: row.effective_target != null ? Number(row.effective_target) : null,
        pausedAt: row.paused_at ?? null,
        enabled: row.enabled ?? null,
        lastHeartbeat: row.last_heartbeat ?? null,
      });
    };

    supabase
      .from('pi_live_state')
      .select('target_source, effective_target, paused_at, enabled, last_heartbeat')
      .eq('controller_id', controllerId)
      .maybeSingle()
      .then(({ data }) => apply(data));

    supabase
      .from('pi_setpoint')
      .select('commanded_at')
      .eq('controller_id', controllerId)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setCommandedAt((data as any)?.commanded_at ?? null); });

    const channel = supabase
      .channel(`pi-remote-${controllerId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'pi_live_state',
        filter: `controller_id=eq.${controllerId}`,
      }, (payload) => apply(payload.new))
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [controllerId, active]);

  // Kvittens: kommandot är bekräftat först när Pi:n hörts av efter att vi tryckte.
  const pending = commandedAt != null && (
    state.lastHeartbeat == null || new Date(state.lastHeartbeat) < new Date(commandedAt)
  );

  const command = useCallback(async (patch: Record<string, unknown>) => {
    setSending(true);
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('pi_setpoint')
      .upsert({
        controller_id: controllerId,
        set_by: 'cloud',
        set_at: now,
        commanded_at: now,
        ...patch,
      } as any, { onConflict: 'controller_id' });
    setSending(false);
    if (error) throw error;
    setCommandedAt(now);
  }, [controllerId]);

  return {
    ...state,
    commandedAt,
    pending,
    sending,
    // Manuellt mål pausar profilen på Pi:n.
    setManualTarget: (temp: number) => command({ target_temp: temp, enabled: true }),
    // null = släpp overriden, profilen får tillbaka styrningen.
    releaseToProfile: () => command({ target_temp: null }),
    setEnabled: (enabled: boolean) => command({ enabled }),
  };
}
