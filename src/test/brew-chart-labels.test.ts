import { describe, expect, it } from 'vitest';
import { getEventLabelLanes } from '@/components/brew-chart/utils';

const event = (id: string, timestamp: number) => ({ id, timestamp, event_type: 'other', event_date: new Date(timestamp).toISOString(), notes: null });
const LABEL_H = 'Anteckning'.length * 6 + 4; // 64 px

describe('TV event label offsets', () => {
  it('keeps distant labels at the bottom edge', () => {
    const events = [event('a', 100), { ...event('pitch', 120), event_type: 'jast' }, event('c', 140), event('far', 300)];
    expect([...getEventLabelLanes(events, 0, 1000, 1000).values()]).toEqual([0, 0, 0, 0]);
  });
  it('uses actual pixel distance as the chart width changes', () => {
    const events = [event('a', 100), event('b', 150)];
    expect([...getEventLabelLanes(events, 0, 1000, 400).values()]).toEqual([0, 0]);
    expect([...getEventLabelLanes(events, 0, 1000, 100).values()]).toEqual([0, LABEL_H]);
  });
  it('stacks coincident labels upward without overlap and ignores events outside the visible range', () => {
    expect([...getEventLabelLanes([event('a', 100), { ...event('pitch', 100), event_type: 'jast' }, event('c', 100), event('outside', 1100)], 0, 1000, 1000).values()]).toEqual([0, LABEL_H, LABEL_H * 2]);
  });
});
