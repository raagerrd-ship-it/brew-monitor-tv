import { describe, it, expect } from 'vitest';
import { getStatusDisplayText } from '@/components/brew-card/utils';
import type { BrewData } from '@/types/brew';

const base = { status: 'Jäsning', linked_controller_id: null, linked_pill_id: null, sgData: [] } as unknown as BrewData;

describe('getStatusDisplayText', () => {
  it('counts pitch day as day 1 rather than using older SG readings', () => {
    expect(getStatusDisplayText({ ...base, linked_controller_id: 'blue', fermentationStart: new Date(Date.now() - 16 * 3600000).toISOString(), sgData: [{ date: '2020-01-01', value: 1.055, temp: 19 }] })).toBe('Jäsning dag 1');
  });
  it('uses the same 1-based convention after four full days', () => {
    expect(getStatusDisplayText({ ...base, linked_controller_id: 'yellow', fermentationStart: new Date(Date.now() - (4 * 24 + 12) * 3600000).toISOString() })).toBe('Jäsning dag 5');
  });

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
