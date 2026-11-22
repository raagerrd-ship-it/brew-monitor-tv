import { describe, expect, it } from 'vitest';
import { getEventLabelLanes, getEventChartTimestamp } from '@/components/brew-chart/utils';

const event = (id: string, timestamp: number) => ({ id, timestamp, event_type: 'other', event_date: new Date(timestamp).toISOString(), notes: null });

describe('slanted event label offsets', () => {
  it('retains Blå’s real pitch when the first stored snapshot is 51 minutes later', () => {
    const start = Date.parse('2026-11-21T17:00:00Z');
    const end = Date.parse('2026-11-22T09:06:00Z');
    const timestamp = Date.parse('2026-11-21T16:09:05Z');
    const pitch = { ...event('pitch-blue', timestamp), event_type: 'jast' };
    expect(getEventChartTimestamp(timestamp, start, end, 'jast')).toBe(start);
    expect(getEventLabelLanes([pitch], start, end, 400).get('pitch-blue')).toBe(4);
    expect(getEventChartTimestamp(start - 3600001, start, end, 'jast')).toBeNull();
    expect(getEventChartTimestamp(timestamp, start, end, 'other')).toBeNull();
  });
  it('keeps pitch events at or up to five minutes before the start on the left edge', () => {
    const start = Date.parse('2026-11-21T16:10:00Z');
    const end = start + 24 * 60 * 60 * 1000;
    for (const timestamp of [start, Date.parse('2026-11-21T16:09:05Z'), start - 5 * 60 * 1000]) {
      const pitch = { ...event('pitch', timestamp), event_type: 'jast' };
      expect(getEventChartTimestamp(timestamp, start, end)).toBe(start);
      expect(getEventLabelLanes([pitch], start, end, 400).get('pitch')).toBe(4);
    }
    expect(getEventChartTimestamp(start - 5 * 60 * 1000 - 1, start, end)).toBeNull();
    expect(getEventLabelLanes([event('old', start - 5 * 60 * 1000 - 1)], start, end, 400).has('old')).toBe(false);
    expect(getEventChartTimestamp(start + 60000, start, end)).toBe(start + 60000);
    expect(getEventChartTimestamp(end + 1, start, end)).toBeNull();
  });
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
