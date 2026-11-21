import { describe, expect, it } from 'vitest';
import { getBrewDayItemState } from '@/components/brew-card/BrewDayCard';
import type { BrewDayItem } from '@/hooks/use-brew-day';

const item: BrewDayItem = { id: 'disinfect', name: 'Desinficering', amount: null, unit: null, at_min: 15, checked: false };

describe('bryggdagens punkttillstånd', () => {
  it('checked is always done, even when its time is reached', () => {
    expect(getBrewDayItemState({ ...item, checked: true }, true, 0)).toBe('done');
  });
  it('the next item waits at 42:20', () => {
    expect(getBrewDayItemState(item, true, 2540)).toBe('waiting');
  });
  it('the next item becomes now exactly at zero', () => {
    expect(getBrewDayItemState(item, true, 1)).toBe('waiting');
    expect(getBrewDayItemState(item, true, 0)).toBe('now');
  });
  it('the next item remains now after its time passes', () => {
    expect(getBrewDayItemState(item, true, -1)).toBe('now');
  });
  it('the next item without at_min is now without a timer', () => {
    expect(getBrewDayItemState({ ...item, at_min: null }, true, null)).toBe('now');
  });
  it('all later unfinished items wait even without at_min or with a reached time', () => {
    expect(getBrewDayItemState({ ...item, at_min: null }, false, null)).toBe('waiting');
    expect(getBrewDayItemState(item, false, 0)).toBe('waiting');
  });
  it('a timed item without an active countdown waits', () => {
    expect(getBrewDayItemState(item, true, null)).toBe('waiting');
  });
});