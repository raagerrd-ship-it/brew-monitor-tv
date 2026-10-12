import { describe, it, expect } from 'vitest';
import { applyMilestonePause, pickAlertMilestone } from '@/lib/timer-milestones';

describe('local milestone alarms', () => {
  const hop = { time: 900, label: 'Citra 30 g' };

  it('due milestone without flags alerts once', () => {
    const shown = new Set<string>();
    const first = pickAlertMilestone([hop], 880, shown, 1000);
    expect(first?.label).toBe('Citra 30 g');
    shown.add(first!.label);
    expect(pickAlertMilestone([hop], 870, shown, 1000)).toBeNull();
  });

  it('acknowledged milestone does not alert', () => {
    expect(pickAlertMilestone([{ ...hop, acknowledged: true }], 880, new Set(), 1000)).toBeNull();
    expect(pickAlertMilestone([{ ...hop, ack: true }], 880, new Set(), 1000)).toBeNull();
  });

  it('does not alert when overdue more than 120 s', () => {
    expect(pickAlertMilestone([hop], 700, new Set(), 1000)).toBeNull();
  });

  it('does not alert locally when the app already passed the milestone', () => {
    // Base 500 ≤ milestone 900: the app's latest message was already past it.
    expect(pickAlertMilestone([hop], 450, new Set(), 500)).toBeNull();
  });

  it('pausing milestone freezes the countdown', () => {
    const p = { time: 600, label: 'Whirlpool', pauseHere: true };
    expect(applyMilestonePause(550, [p], 1000)).toEqual({ remaining: 600, frozen: true });
    expect(applyMilestonePause(650, [p], 1000)).toEqual({ remaining: 650, frozen: false });
    expect(applyMilestonePause(550, [{ ...p, acknowledged: true }], 1000)).toEqual({ remaining: 550, frozen: false });
  });

  it('does not freeze when the app already passed the pausing milestone', () => {
    // Base 500 ≤ milestone 600: the app's latest message was already past it.
    const p = { time: 600, label: 'Whirlpool', pauseHere: true };
    expect(applyMilestonePause(450, [p], 500)).toEqual({ remaining: 450, frozen: false });
  });
});
