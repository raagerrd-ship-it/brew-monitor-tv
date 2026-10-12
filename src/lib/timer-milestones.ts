import type { TimerMilestone } from '@/hooks/use-external-timer';

const DUE_WINDOW_S = 120;

export const isAcked = (m: TimerMilestone) => m.acknowledged === true || m.ack === true;

/**
 * Unacknowledged pausing milestone reached by the local countdown freezes it at its `time`.
 * Only when the TV's own countdown passed it after the app's latest message
 * (`baseRemaining > m.time`); otherwise the app's flags rule.
 */
export function applyMilestonePause(rawRemaining: number, milestones: TimerMilestone[], baseRemaining: number) {
  const hit = milestones
    .filter(m => m.time > 0 && (m.pauseHere || m.pauseForTemperature) && !isAcked(m) && baseRemaining > m.time && rawRemaining <= m.time)
    .sort((a, b) => b.time - a.time)[0];
  return hit ? { remaining: hit.time, frozen: true } : { remaining: rawRemaining, frozen: false };
}

/** Latest milestone the local countdown has passed (smallest time ≥ remaining). */
export function latestPassed(remaining: number, milestones: TimerMilestone[]) {
  return milestones
    .filter(m => m.time > 0 && remaining <= m.time)
    .sort((a, b) => a.time - b.time)[0] ?? null;
}

/**
 * Milestone that should raise "Dags nu!": flagged by the app or due by the local countdown (≤120 s ago).
 * Local due only counts when the TV's own countdown passed it after the app's latest message
 * (`baseRemaining > m.time`); otherwise the app's flags rule.
 */
export function pickAlertMilestone(milestones: TimerMilestone[], remaining: number, shown: Set<string>, baseRemaining: number) {
  const hasCurrentFlag = milestones.some(m => m.current === true);
  const flagged = milestones.find(m => {
    const isNow = hasCurrentFlag ? m.current === true : m.triggered === true;
    return isNow && !isAcked(m) && !shown.has(m.label);
  });
  if (flagged) return flagged;
  return milestones
    .filter(m => m.time > 0 && baseRemaining > m.time && remaining <= m.time && m.time - remaining <= DUE_WINDOW_S && !isAcked(m) && !shown.has(m.label))
    .sort((a, b) => a.time - b.time)[0] ?? null;
}
