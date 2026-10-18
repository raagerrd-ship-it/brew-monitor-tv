import type { BrewData } from '@/types/brew';

export const KEG_STATUSES = ['Klar', 'Completed'];

/** Statuses TV-korten kan visa — senaste ölet väljs bland dessa. */
const TV_VISIBLE_EXCLUDED = ['Arkiverad', 'Archived', 'Konditionering', 'Conditioning'];

export function selectTvBrewIds(
  activeIds: string[],
  ready: { id: string; status: string }[],
  latestId?: string | null,
): string[] {
  const chosen: string[] = [];
  if (latestId) chosen.push(latestId);
  const kegIds = ready.filter(b => KEG_STATUSES.includes(b.status)).map(b => b.id);
  const activeFresh = activeIds.filter(id => !kegIds.includes(id));
  const activeKeg = activeIds.filter(id => kegIds.includes(id));
  for (const id of [...activeFresh, ...activeKeg]) if (!chosen.includes(id)) chosen.push(id);
  for (const id of kegIds) {
    if (chosen.length >= 3) break;
    if (!chosen.includes(id)) chosen.push(id);
  }
  return chosen.slice(0, 3);
}


export function isTvVisibleBrewStatus(status: string): boolean {
  return !TV_VISIBLE_EXCLUDED.includes(status);
}


export function freezeKegBrew(brew: BrewData): BrewData {
  return {
    ...brew, status: 'Klar', frozen: true, linked_controller_id: null, linked_pill_id: null,
    fermentationSession: null, fermentationRate: 0, fermentationTrend: undefined,
    fermentationMetrics: null, dutyPct: null, dutyMode: null,
    overshootReason: null, originalTarget: null, pidReason: null,
  };
}