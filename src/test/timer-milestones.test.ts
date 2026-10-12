import { describe, it, expect } from 'vitest';
import { applyMilestonePause, pickAlertMilestone } from '@/lib/timer-milestones';

describe('local milestone alarms', () => {
  const hop = { time: 900, label: 'Citra 30 g' };

  it('due milestone without flags alerts once', () => {
    const shown = new Set<string>();
    const first = pickAlertMilestone([hop], 880, shown);
    expect(first?.label).toBe('Citra 30 g');
    shown.add(first!.label);
    expect(pickAlertMilestone([hop], 870, shown)).toBeNull();
  });

  it('acknowledged milestone does not alert', () => {
    expect(pickAlertMilestone([{ ...hop, acknowledged: true }], 880, new Set())).toBeNull();
    expect(pickAlertMilestone([{ ...hop, ack: true }], 880, new Set())).toBeNull();
  });

  it('does not alert when overdue more than 120 s', () => {
    expect(pickAlertMilestone([hop], 700, new Set())).toBeNull();
  });

  it('pausing milestone freezes the countdown', () => {
    const p = { time: 600, label: 'Whirlpool', pauseHere: true };
    expect(applyMilestonePause(550, [p])).toEqual({ remaining: 600, frozen: true });
    expect(applyMilestonePause(650, [p])).toEqual({ remaining: 650, frozen: false });
    expect(applyMilestonePause(550, [{ ...p, acknowledged: true }])).toEqual({ remaining: 550, frozen: false });
  });
});
