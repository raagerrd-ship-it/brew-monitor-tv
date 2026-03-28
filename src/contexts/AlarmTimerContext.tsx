import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { useDashboardFooter } from '@/contexts/DashboardFooterContext';
import { useDashboardAlert } from '@/contexts/DashboardAlertContext';
import { AlarmTimerFooterBar } from '@/components/AlarmTimerFooterBar';
import { AlertTriangle, Timer, AlarmClock } from 'lucide-react';

export type AlarmTimerType = 'timer' | 'alarm';

export interface AlarmTimerEntry {
  id: string;
  type: AlarmTimerType;
  /** When the alarm/timer fires (epoch ms) */
  endsAt: number;
  /** When it was started (epoch ms) */
  startedAt: number;
  /** Total duration in ms (for progress calculation) */
  totalMs: number;
  /** Label shown in footer bar */
  label: string;
  /** Text displayed in the alert overlay */
  alertText: string;
  /** How many seconds the alert stays visible */
  alertDurationSec: number;
  /** Whether it has already fired */
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

export function AlarmTimerProvider({ children }: { children: ReactNode }) {
  const [entry, setEntry] = useState<AlarmTimerEntry | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const { setFooterSlot, clearFooterSlot } = useDashboardFooter();
  const { showAlert } = useDashboardAlert();
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cancel = useCallback(() => {
    setEntry(null);
    setRemainingMs(0);
  }, []);

  const startTimer = useCallback((minutes: number, alertText: string, alertDurationSec: number, label?: string) => {
    const now = Date.now();
    const totalMs = minutes * 60 * 1000;
    setEntry({
      id: `timer-${now}`,
      type: 'timer',
      endsAt: now + totalMs,
      startedAt: now,
      totalMs,
      label: label || `Timer ${minutes} min`,
      alertText,
      alertDurationSec,
      fired: false,
    });
    setRemainingMs(totalMs);
  }, []);

  const setAlarm = useCallback((targetTime: string, alertText: string, alertDurationSec: number, label?: string) => {
    const now = new Date();
    const [hours, minutes] = targetTime.split(':').map(Number);
    const target = new Date(now);
    target.setHours(hours, minutes, 0, 0);
    // If the time has already passed today, set it for tomorrow
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    const totalMs = target.getTime() - now.getTime();
    setEntry({
      id: `alarm-${Date.now()}`,
      type: 'alarm',
      endsAt: target.getTime(),
      startedAt: now.getTime(),
      totalMs,
      label: label || `Alarm ${targetTime}`,
      alertText,
      alertDurationSec,
      fired: false,
    });
    setRemainingMs(totalMs);
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
    const clearTimer = setTimeout(() => {
      setEntry(null);
      setRemainingMs(0);
    }, entry.alertDurationSec * 1000 + 500);
    return () => clearTimeout(clearTimer);
  }, [entry?.fired]);

  // Manage footer slot
  useEffect(() => {
    if (entry && !entry.fired) {
      setFooterSlot(
        <AlarmTimerFooterBar entry={entry} remainingMs={remainingMs} onCancel={cancel} />,
        FOOTER_HEIGHT,
      );
    } else {
      clearFooterSlot();
    }
  }, [entry?.id, entry?.fired, remainingMs, cancel, setFooterSlot, clearFooterSlot]);

  // Cleanup footer on unmount
  useEffect(() => () => clearFooterSlot(), [clearFooterSlot]);

  return (
    <AlarmTimerContext.Provider value={{ entry, remainingMs, startTimer, setAlarm, cancel }}>
      {children}
    </AlarmTimerContext.Provider>
  );
}
