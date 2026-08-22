import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type TargetSource = 'profile' | 'manual' | 'off' | null;

export interface PiRemoteState {
  targetSource: TargetSource;
  effectiveTarget: number | null;
  pausedAt: string | null;
  enabled: boolean | null;
  lastHeartbeat: string | null;
  piTarget: number | null;
  commandedTarget: number | null;
  commandedEnabled: boolean | null;
}

/**
 * Fjärrkontroll mot Pi:n. Molnet uttrycker bara AVSIKT i pi_setpoint;
 * Pi:n är master och ekar tillbaka target_source/effective_target i pi_live_state.
 */
export function usePiRemoteControl(controllerId: string, active = true) {
  const [state, setState] = useState<PiRemoteState>({
    targetSource: null, effectiveTarget: null, pausedAt: null, enabled: null, lastHeartbeat: null, piTarget: null, commandedTarget: null, commandedEnabled: null,
  });
  const [commandedAt, setCommandedAt] = useState<string | null>(null);
  const [sending, setSending] = useState(false);


  useEffect(() => {
    if (!active || !controllerId) return;
    let cancelled = false;

    const apply = (row: any) => {
      if (!row || cancelled) return;
      setState((prev) => ({
        ...prev,
        targetSource: (row.target_source ?? null) as TargetSource,
        effectiveTarget: row.effective_target != null ? Number(row.effective_target) : null,
        pausedAt: row.paused_at ?? null,
        enabled: row.enabled ?? null,
        lastHeartbeat: row.last_heartbeat ?? null,
        piTarget: row.target_temp != null ? Number(row.target_temp) : null,
      }));
    };

    const applySetpoint = (row: any) => {
      if (!row || cancelled) return;
      setState((prev) => ({
        ...prev,
        commandedTarget: row.target_temp != null ? Number(row.target_temp) : null,
        commandedEnabled: row.enabled ?? null,
      }));
      setCommandedAt(row.commanded_at ?? null);
    };


    // Pi:n skriver ibland kort 8-teckens id — matcha båda formerna.
    const shortId = controllerId.slice(0, 8);
    supabase
      .from('pi_live_state')
      .select('target_source, effective_target, paused_at, enabled, last_heartbeat, target_temp, controller_id')
      .like('controller_id', `${shortId}%`)
      .limit(1)
      .then(({ data }) => apply(data?.[0]));

    supabase
      .from('pi_setpoint')
      .select('commanded_at, target_temp, enabled')
      .eq('controller_id', controllerId)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) applySetpoint(data); });

    const channel = supabase
      .channel(`pi-remote-${controllerId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'pi_live_state',
      }, (payload) => {
        const rowId = String((payload.new as any)?.controller_id ?? '');
        if (rowId.slice(0, 8) === shortId) apply(payload.new);
      })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'pi_setpoint',
      }, (payload) => {
        const rowId = String((payload.new as any)?.controller_id ?? '');
        if (rowId === controllerId) applySetpoint(payload.new);
      })
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
    // Optimistisk kvittens så UI:t visar "väntar på Pi:n" direkt.
    setState((prev) => ({
      ...prev,
      commandedTarget: 'target_temp' in patch ? (patch.target_temp as number | null) : prev.commandedTarget,
      commandedEnabled: 'enabled' in patch ? (patch.enabled as boolean) : prev.commandedEnabled,
    }));
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
