import { describe, expect, it } from 'vitest';
import { getEventLabelLanes } from '@/components/brew-chart/utils';

const event = (id: string, timestamp: number) => ({ id, timestamp, event_type: 'other', event_date: new Date(timestamp).toISOString(), notes: null });

describe('TV event label lanes', () => {
  it('separates close labels, including pitch, and reuses a free height', () => {
    const events = [event('a', 100), { ...event('pitch', 120), event_type: 'jast' }, event('c', 140), event('far', 300)];
    expect([...getEventLabelLanes(events, 0, 1000, 1000).values()]).toEqual([0, 1, 0, 0]);
  });
  it('uses actual pixel distance as the chart width changes', () => {
    const events = [event('a', 100), event('b', 150)];
    expect([...getEventLabelLanes(events, 0, 1000, 400).values()]).toEqual([0, 1]);
    expect([...getEventLabelLanes(events, 0, 1000, 1000).values()]).toEqual([0, 0]);
  });
  it('separates coincident labels and ignores events outside the visible range', () => {
    expect([...getEventLabelLanes([event('a', 100), event('b', 100), event('c', 100), event('outside', 1100)], 0, 1000, 1000).values()]).toEqual([0, 1, 2]);
  });
});