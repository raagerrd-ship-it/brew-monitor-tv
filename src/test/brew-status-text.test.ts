import { describe, it, expect } from 'vitest';
import { getStatusDisplayText } from '@/components/brew-card/utils';
import type { BrewData } from '@/types/brew';

const base = { status: 'Jäsning', linked_controller_id: null, linked_pill_id: null, sgData: [] } as unknown as BrewData;

describe('getStatusDisplayText', () => {
  it('shows "Väntar på jästank" for a received brew with no tank, pill or readings', () => {
    expect(getStatusDisplayText(base)).toBe('Väntar på jästank');
  });
  it('keeps fermentation day count for a pill-only brew that logs readings', () => {
    const brew = { ...base, linked_pill_id: 'pill', sgData: [{ date: '2026-11-16', value: 1.05, temp: 19 }] } as unknown as BrewData;
    expect(getStatusDisplayText(brew)).toMatch(/^Jäsning dag \d+$/);
  });
  it('keeps fermentation day count for a tank-less brew that already has readings', () => {
    const brew = { ...base, sgData: [{ date: '2026-11-16', value: 1.05, temp: 19 }] } as unknown as BrewData;
    expect(getStatusDisplayText(brew)).toMatch(/^Jäsning dag \d+$/);
  });
  it('never shows "Väntar på jästank" for a frozen keg card', () => {
    const brew = { ...base, status: 'Klar', frozen: true } as unknown as BrewData;
    expect(getStatusDisplayText(brew)).toBe('Klar');
  });
});
