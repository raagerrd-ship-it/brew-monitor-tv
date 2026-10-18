import type { BrewData } from '@/types/brew';

export const KEG_STATUSES = ['Klar', 'Completed'];

export function selectTvBrewIds(activeIds: string[], ready: { id: string; status: string }[]): string[] {
  const kegIds = ready.filter(b => KEG_STATUSES.includes(b.status)).map(b => b.id);
  const active = [...new Set(activeIds)].filter(id => !kegIds.includes(id));
  return [...active, ...kegIds.slice(0, Math.max(0, 3 - active.length))];
}

export function freezeKegBrew(brew: BrewData): BrewData {
  return {
    ...brew, status: 'Klar', frozen: true, linked_controller_id: null, linked_pill_id: null,
    fermentationSession: null, fermentationRate: 0, fermentationTrend: undefined,
    fermentationMetrics: null, dutyPct: null, dutyMode: null,
    overshootReason: null, originalTarget: null, pidReason: null,
  };
}