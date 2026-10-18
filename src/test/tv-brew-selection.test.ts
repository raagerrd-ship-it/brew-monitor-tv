import { describe, it, expect } from 'vitest';
import { selectTvBrewIds, freezeKegBrew } from '@/lib/tv-brew-selection';
import type { BrewData } from '@/types/brew';

describe('TV keg cards', () => {
  it('fills two active brews to three with one completed brew', () => {
    expect(selectTvBrewIds(['a', 'b'], [{ id: 'c', status: 'Klar' }, { id: 'd', status: 'Completed' }])).toEqual(['a', 'b', 'c']);
  });
  it('always keeps the latest beer even when three active brews fill the cards', () => {
    expect(selectTvBrewIds(['a', 'b', 'c'], [{ id: 'd', status: 'Klar' }], 'd')).toEqual(['d', 'a', 'b']);
  });
  it('does not duplicate the latest beer when it is already an active brew', () => {
    expect(selectTvBrewIds(['a', 'b', 'c'], [{ id: 'd', status: 'Klar' }], 'a')).toEqual(['a', 'b', 'c']);
  });
  it('parks the latest keg beer first and does not reserve extra slots', () => {
    expect(selectTvBrewIds(['a', 'b'], [{ id: 'c', status: 'Klar' }, { id: 'e', status: 'Klar' }], 'c')).toEqual(['c', 'a', 'b']);
  });
  it('behaves as before when there is no latest beer', () => {
    expect(selectTvBrewIds(['a', 'b'], [{ id: 'c', status: 'Klar' }], null)).toEqual(['a', 'b', 'c']);
  });
  it('treats archived and conditioning as not TV-visible', () => {
    expect(isTvVisibleBrewStatus('Arkiverad')).toBe(false);
    expect(isTvVisibleBrewStatus('Archived')).toBe(false);
    expect(isTvVisibleBrewStatus('Konditionering')).toBe(false);
    expect(isTvVisibleBrewStatus('Conditioning')).toBe(false);
    expect(isTvVisibleBrewStatus('Jäsning')).toBe(true);
    expect(isTvVisibleBrewStatus('Klar')).toBe(true);
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
    expect(freezeKegBrew(brew)).toMatchObject({ status: 'Klar', frozen: true, currentSG: 1.012, currentTemp: 4.2,
      abv: 5.6, attenuation: 78, linked_controller_id: null, linked_pill_id: null, dutyPct: null, fermentationSession: null });
    expect(freezeKegBrew(brew).sgData).toBe(brew.sgData);
  });
});