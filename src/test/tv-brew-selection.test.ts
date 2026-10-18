import { describe, it, expect } from 'vitest';
import { selectTvBrewIds, freezeKegBrew } from '@/lib/tv-brew-selection';
import type { BrewData } from '@/types/brew';

describe('TV keg cards', () => {
  it('fills two active brews to three with one completed brew', () => {
    expect(selectTvBrewIds(['a', 'b'], [{ id: 'c', status: 'Klar' }, { id: 'd', status: 'Completed' }])).toEqual(['a', 'b', 'c']);
  });
  it('does not replace active brews when three already exist', () => {
    expect(selectTvBrewIds(['a', 'b', 'c'], [{ id: 'd', status: 'Klar' }])).toEqual(['a', 'b', 'c']);
  });
  it('does not invent cards or include archived or conditioning beer', () => {
    expect(selectTvBrewIds(['a'], [{ id: 'b', status: 'Arkiverad' }, { id: 'c', status: 'Konditionering' }])).toEqual(['a']);
  });
  it('puts completed session IDs after active beer without duplicates', () => {
    expect(selectTvBrewIds(['k', 'a'], [{ id: 'k', status: 'Klar' }])).toEqual(['a', 'k']);
  });
  it('keeps measured values while disconnecting live tank and profile data', () => {
    const brew = { currentSG: 1.012, currentTemp: 4.2, abv: 5.6, attenuation: 78,
      linked_controller_id: 'tank', linked_pill_id: 'pill', dutyPct: 50, sgData: [{ date: '2026-10-01', value: 1.012, temp: 4.2 }] } as BrewData;
    expect(freezeKegBrew(brew)).toMatchObject({ frozen: true, currentSG: 1.012, currentTemp: 4.2,
      abv: 5.6, attenuation: 78, linked_controller_id: null, linked_pill_id: null, dutyPct: null, fermentationSession: null });
    expect(freezeKegBrew(brew).sgData).toBe(brew.sgData);
  });
});