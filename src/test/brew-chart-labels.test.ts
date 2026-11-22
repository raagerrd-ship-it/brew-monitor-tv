import { describe, expect, it } from 'vitest';
import { getEventLabelLanes, getEventStripHeight } from '@/components/brew-chart/utils';

const event = (id: string, timestamp: number) => ({ id, timestamp, event_type: 'other', event_date: new Date(timestamp).toISOString(), notes: null });

describe('event pill placement', () => {
  it('reserves no strip without visible events and exactly 21px per occupied row', () => {
    expect(getEventStripHeight(new Map())).toBe(0);
    expect(getEventStripHeight(getEventLabelLanes([event('a', 0)], 0, 1000, 200))).toBe(21);
    expect(getEventStripHeight(getEventLabelLanes([event('a', 0), event('b', 0)], 0, 1000, 200))).toBe(42);
    expect(getEventStripHeight(getEventLabelLanes([event('a', 0), event('b', 0), event('c', 0)], 0, 1000, 200))).toBe(63);
    expect(getEventStripHeight(getEventLabelLanes([event('outside', 1100)], 0, 1000, 200))).toBe(0);
  });
  it('keeps distant events in the first row', () => {
    const labels = getEventLabelLanes([event('a', 100), event('b', 800)], 0, 1000, 400);
    expect([...labels.values()].map(label => label.row)).toEqual([0, 0]);
  });
  it('reflows collisions when the plot narrows', () => {
    const events = [event('a', 100), event('b', 400)];
    expect([...getEventLabelLanes(events, 0, 1000, 400).values()].map(label => label.row)).toEqual([0, 0]);
    expect([...getEventLabelLanes(events, 0, 1000, 100).values()].map(label => label.row)).toEqual([0, 1]);
  });
  it('clamps both edges and stacks three coincident events without moving timestamps', () => {
    const labels = getEventLabelLanes([event('a', 0), { ...event('pitch', 0), event_type: 'jast' }, event('c', 0), event('end', 1000), event('outside', 1100)], 0, 1000, 200);
    expect([...labels.values()].slice(0, 3).map(label => label.row)).toEqual([0, 1, 2]);
    expect(labels.get('a')?.left).toBe(0);
    const last = labels.get('end');
    expect(last && last.left + last.width).toBe(200);
    expect(labels.has('outside')).toBe(false);
  });
});
