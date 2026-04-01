import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { useDashboardFooter } from '@/contexts/DashboardFooterContext';
import { useDashboardAlert } from '@/contexts/DashboardAlertContext';
import { AlarmTimerFooterBar } from '@/components/AlarmTimerFooterBar';
import { AlertTriangle, Timer, AlarmClock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

export type AlarmTimerType = 'timer' | 'alarm';

export interface AlarmTimerEntry {
  id: string;
  type: AlarmTimerType;
  endsAt: number;
  startedAt: number;
  totalMs: number;
  label: string;
  alertText: string;
  alertDurationSec: number;
  fired: boolean;
}

interface AlarmTimerContextType {
  entry: AlarmTimerEntry | null;
  remainingMs: number;
  startTimer: (minutes: number, alertText: string, alertDurationSec: number, label?: string) => void;
  setAlarm: (targetTime: string, alertText: string, alertDurationSec: number, label?: string) => void;
  cancel: () => void;
}

const AlarmTimerContext = createContext<AlarmTimerContextType>({
  entry: null,
  remainingMs: 0,
  startTimer: () => {},
  setAlarm: () => {},
  cancel: () => {},
});

export function useAlarmTimer() {
  return useContext(AlarmTimerContext);
}

const FOOTER_HEIGHT = 48;

/** Convert DB row to local entry */
function rowToEntry(row: any): AlarmTimerEntry | null {
  if (!row?.is_active || !row.type || !row.ends_at) return null;
  const endsAt = new Date(row.ends_at).getTime();
  return {
    id: row.id,
    type: row.type as AlarmTimerType,
    endsAt,
    startedAt: row.started_at ? new Date(row.started_at).getTime() : Date.now(),
    totalMs: row.total_ms ?? 0,
    label: row.label ?? '',
    alertText: row.alert_text ?? '',
    alertDurationSec: row.alert_duration_sec ?? 10,
    fired: row.fired ?? false,
  };
}

async function upsertTimer(data: {
  type: string;
  ends_at: string;
  started_at: string;
  total_ms: number;
  label: string;
  alert_text: string;
  alert_duration_sec: number;
  is_active: boolean;
  fired: boolean;
}) {
  // Try update first (singleton pattern — no need to know the id)
  const { data: updated } = await supabase
    .from('shared_timer')
    .update({ ...data, updated_at: new Date().toISOString() })
    .not('id', 'is', null)
    .select('id');

  // If no rows updated, insert
  if (!updated || updated.length === 0) {
    await supabase.from('shared_timer').insert(data);
  }
}

/** Clear timer in DB (singleton — update all rows) */
async function clearTimerInDb() {
  await supabase
    .from('shared_timer')
    .update({ is_active: false, fired: false, updated_at: new Date().toISOString() })
    .not('id', 'is', null);
}

export function AlarmTimerProvider({ children }: { children: ReactNode }) {
  const [entry, setEntry] = useState<AlarmTimerEntry | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const { setFooterSlot, clearFooterSlot } = useDashboardFooter();
  const { showAlert } = useDashboardAlert();
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const firedLocallyRef = useRef<string | null>(null);

  const cancel = useCallback(async () => {
    setEntry(null);
    setRemainingMs(0);
    firedLocallyRef.current = null;
    await clearTimerInDb();
  }, []);

  const startTimer = useCallback(async (minutes: number, alertText: string, alertDurationSec: number, label?: string) => {
    const now = Date.now();
    const totalMs = minutes * 60 * 1000;
    const endsAt = new Date(now + totalMs);

    await upsertTimer({
      type: 'timer',
      ends_at: endsAt.toISOString(),
      started_at: new Date(now).toISOString(),
      total_ms: totalMs,
      label: label || `Timer ${minutes} min`,
      alert_text: alertText,
      alert_duration_sec: alertDurationSec,
      is_active: true,
      fired: false,
    });
  }, []);

  const setAlarm = useCallback(async (targetTime: string, alertText: string, alertDurationSec: number, label?: string) => {
    const now = new Date();
    const [hours, minutes] = targetTime.split(':').map(Number);
    const target = new Date(now);
    target.setHours(hours, minutes, 0, 0);
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    const totalMs = target.getTime() - now.getTime();

    await upsertTimer({
      type: 'alarm',
      ends_at: target.toISOString(),
      started_at: now.toISOString(),
      total_ms: totalMs,
      label: label || 'Alarm',
      alert_text: alertText,
      alert_duration_sec: alertDurationSec,
      is_active: true,
      fired: false,
    });
  }, []);

  // Load initial state from DB
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('shared_timer')
        .select('*')
        .limit(1)
        .single();
      if (data) {
        const e = rowToEntry(data);
        if (e && !e.fired) {
          setEntry(e);
          setRemainingMs(Math.max(0, e.endsAt - Date.now()));
        }
      }
    })();
  }, []);

  // Subscribe to realtime changes
  useEffect(() => {
    const channel = supabase
      .channel('shared-timer')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shared_timer' },
        (payload) => {
          const row = payload.new as any;
          if (!row) return;

          if (!row.is_active) {
            setEntry(null);
            setRemainingMs(0);
            return;
          }

          const e = rowToEntry(row);
          if (e) {
            setEntry(e);
            setRemainingMs(Math.max(0, e.endsAt - Date.now()));
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Tick every second
  useEffect(() => {
    if (!entry || entry.fired) {
      if (tickRef.current) clearInterval(tickRef.current);
      return;
    }
    const tick = () => {
      const left = entry.endsAt - Date.now();
      if (left <= 0) {
        setRemainingMs(0);
        setEntry(prev => prev ? { ...prev, fired: true } : null);
        // Conditional update — only one client wins the race
        if (firedLocallyRef.current !== entry.id) {
          firedLocallyRef.current = entry.id;
          supabase
            .from('shared_timer')
            .update({ fired: true, updated_at: new Date().toISOString() })
            .eq('id', entry.id)
            .eq('fired', false)
            .eq('is_active', true)
            .then(() => {});
        }
      } else {
        setRemainingMs(left);
      }
    };
    tick();
    tickRef.current = setInterval(tick, 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [entry?.id, entry?.fired]);

  // Fire alert when timer reaches 0
  useEffect(() => {
    if (!entry?.fired) return;
    const Icon = entry.type === 'timer' ? Timer : AlarmClock;
    showAlert({
      id: `alarm-timer-alert-${entry.id}`,
      autoDismissMs: entry.alertDurationSec * 1000,
      overlayBackground: 'radial-gradient(ellipse at center, hsl(38 90% 30% / 0.4) 0%, hsl(0 0% 0% / 0.85) 100%)',
      content: (
        <div
          className="flex flex-col items-center px-12 py-8 rounded-2xl max-w-[90vw]"
          style={{
            background: 'linear-gradient(145deg, hsl(38 80% 18%) 0%, hsl(222 20% 10%) 100%)',
            border: '2px solid hsl(38 90% 50% / 0.5)',
            boxShadow: '0 0 60px 10px hsl(38 90% 50% / 0.3), inset 0 1px 0 hsl(0 0% 100% / 0.1)',
          }}
        >
          <div
            className="flex items-center gap-3 px-6 py-2 rounded-full mb-5"
            style={{
              background: 'linear-gradient(135deg, hsl(38 90% 55%) 0%, hsl(45 95% 50%) 100%)',
              boxShadow: '0 0 20px hsl(38 90% 55% / 0.5)',
            }}
          >
            <AlertTriangle className="w-6 h-6 text-primary-foreground" />
            <Icon className="w-5 h-5 text-primary-foreground" />
          </div>
          <div className="text-4xl md:text-6xl font-bold text-center leading-tight" style={{ color: 'hsl(40 90% 85%)' }}>
            {entry.alertText}
          </div>
        </div>
      ),
    });
    // Auto-clear the entry after alert dismisses
    const clearTimer = setTimeout(async () => {
      setEntry(null);
      setRemainingMs(0);
      await clearTimerInDb();
    }, entry.alertDurationSec * 1000 + 500);
    return () => clearTimeout(clearTimer);
  }, [entry?.fired]);

  // Manage footer slot — only update on entry change, not every second
  useEffect(() => {
    if (entry && !entry.fired) {
      setFooterSlot(
        <AlarmTimerFooterBar entry={entry} onCancel={cancel} />,
        FOOTER_HEIGHT,
      );
    } else {
      clearFooterSlot();
    }
  }, [entry?.id, entry?.fired, cancel, setFooterSlot, clearFooterSlot]);

  // Cleanup footer on unmount
  useEffect(() => () => clearFooterSlot(), [clearFooterSlot]);

  return (
    <AlarmTimerContext.Provider value={{ entry, remainingMs, startTimer, setAlarm, cancel }}>
      {children}
    </AlarmTimerContext.Provider>
  );
}
