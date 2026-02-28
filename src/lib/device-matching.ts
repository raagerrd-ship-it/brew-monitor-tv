import { BrewData, PillData, TempController } from "@/types/brew";
import { colorKeywords } from "./color-utils";

/**
 * Color groups: keywords that should cross-match each other.
 * If a brew name contains "gyllene", it should match a controller named "gul".
 */
const colorGroups: string[][] = [
  ['gul', 'gyllene', 'guld', 'golden', 'yellow'],
  ['röd', 'red'],
  ['blå', 'blue'],
  ['grön', 'green'],
  ['lila', 'purple'],
  ['rosa', 'pink'],
  ['orange'],
  ['cyan'],
  ['lime'],
  ['amber', 'bärnsten'],
  ['turkos', 'teal'],
  ['indigo'],
  ['violet', 'violett'],
  ['fuchsia'],
  ['rose'],
  ['himmel', 'sky'],
  ['smaragd', 'emerald'],
];

/**
 * Given a list of matched color keywords from the brew name,
 * expand them to include all synonyms from the same color group.
 */
function expandColorGroup(matchedColors: string[]): string[] {
  const expanded = new Set(matchedColors);
  for (const color of matchedColors) {
    const group = colorGroups.find(g => g.includes(color));
    if (group) {
      group.forEach(c => expanded.add(c));
    }
  }
  return Array.from(expanded);
}

export interface DeviceMatch {
  pill: PillData | null;
  controller: TempController | null;
}

/**
 * Find matching pill and controller for a brew based on:
 * 1. paired_device_id from RAPT hardware pairing (pill → controller)
 * 2. Color name matching (with synonym groups)
 * 3. Temperature matching (±3°C tolerance)
 */
export function findDevicesForBrew(
  brew: BrewData,
  pills: PillData[],
  controllers: TempController[]
): DeviceMatch {
  // Automatic matching
  let matchingPill: PillData | null = null;
  let matchingController: TempController | null = null;

  // Try paired_device_id matching first (RAPT hardware pairing)
  const pairedPill = pills.find(p => p.paired_device_id && controllers.some(c => c.controller_id === p.paired_device_id));
  if (pairedPill) {
    const pairedController = controllers.find(c => c.controller_id === pairedPill.paired_device_id) || null;
    if (pairedController) {
      // Check if this pill's temp matches the brew temp (±3°C) to confirm it's the right brew
      const pillTemp = pairedController.pill_temp;
      if (pillTemp !== null && Math.abs(pillTemp - brew.currentTemp) <= 3) {
        return { pill: pairedPill, controller: pairedController };
      }
    }
  }

  const brewNameLower = brew.name.toLowerCase();
  const brewColors = colorKeywords.filter(color => brewNameLower.includes(color));
  // Expand to include synonym groups (e.g. "gyllene" → also match "gul")
  const expandedBrewColors = expandColorGroup(brewColors);

  // Try to match controller by color first
  if (expandedBrewColors.length > 0) {
    matchingController = controllers.find(ctrl => {
      const ctrlNameLower = ctrl.name.toLowerCase();
      return expandedBrewColors.some(color => ctrlNameLower.includes(color));
    }) || null;
  }

  // If we found a controller, get its linked pill
  if (matchingController && matchingController.linked_pill_id) {
    matchingPill = pills.find(p => p.pill_id === matchingController!.linked_pill_id) || null;
  }

  // If no color match, try temperature matching (±3°C tolerance)
  if (!matchingController && !matchingPill) {
    const brewTemp = brew.currentTemp;
    
    matchingController = controllers.find(ctrl => {
      if (ctrl.pill_temp !== null) {
        return Math.abs(ctrl.pill_temp - brewTemp) <= 3;
      }
      if (ctrl.current_temp !== null) {
        return Math.abs(ctrl.current_temp - brewTemp) <= 3;
      }
      return false;
    }) || null;

    if (matchingController && matchingController.linked_pill_id) {
      matchingPill = pills.find(p => p.pill_id === matchingController!.linked_pill_id) || null;
    }
  }

  return { pill: matchingPill, controller: matchingController };
}
