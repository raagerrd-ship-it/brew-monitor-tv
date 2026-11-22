import { describe, expect, it } from 'vitest';
import { getEventLabelLanes } from '@/components/brew-chart/utils';

const event = (id: string, timestamp: number) => ({ id, timestamp, event_type: 'other', event_date: new Date(timestamp).toISOString(), notes: null });

describe('slanted event label offsets', () => {
  it('leaves distant labels next to their dots', () => {
    const labels = getEventLabelLanes([event('a', 100), event('b', 800)], 0, 1000, 400);
    expect(labels.get('a')).toBe(0);
    expect(labels.get('b')).toBe(0);
  });
  it('shifts close labels right just enough to clear the preceding label', () => {
    const labels = getEventLabelLanes([event('a', 100), event('b', 110), event('c', 120)], 0, 1000, 400);
    const width = 'Anteckning'.length * 6.5 * Math.cos(50 * Math.PI / 180) + 8;
    expect(labels.get('a')).toBeCloseTo(0);
    expect(labels.get('b')).toBeCloseTo(width);
    expect(labels.get('c')).toBeCloseTo(width * 2);
  });
  it('moves a right-edge cluster left without moving the dots or overlapping labels', () => {
    const labels = getEventLabelLanes([event('a', 990), event('b', 1000), event('outside', 1100)], 0, 1000, 200);
    const width = 'Anteckning'.length * 6.5 * Math.cos(50 * Math.PI / 180) + 8;
    const leftA = 198 + 4 + (labels.get('a') ?? 0) - 8;
    const leftB = 200 + 4 + (labels.get('b') ?? 0) - 8;
    expect(leftA + width + 4).toBeCloseTo(leftB);
    expect(leftB + width).toBeCloseTo(200);
    expect(labels.get('b')).toBeLessThan(0);
    expect(labels.has('outside')).toBe(false);
  });
});
