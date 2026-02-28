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
  let matchingPill: PillData | null = null;
  let matchingController: TempController | null = null;

  // 1. Direct link: brew has an explicit linked_pill_id (set by sync)
  if (brew.linked_pill_id) {
    matchingPill = pills.find(p => p.pill_id === brew.linked_pill_id) || null;
    // Find controller via pill's paired_device_id
    if (matchingPill?.paired_device_id) {
      matchingController = controllers.find(c => c.controller_id === matchingPill!.paired_device_id) || null;
    }
    // Or via controller's linked_pill_id
    if (!matchingController) {
      matchingController = controllers.find(c => c.linked_pill_id === brew.linked_pill_id) || null;
    }
    if (matchingController) return { pill: matchingPill, controller: matchingController };
  }

  // 2. Direct link: brew has an explicit linked_controller_id
  if (brew.linked_controller_id) {
    matchingController = controllers.find(c => c.controller_id === brew.linked_controller_id) || null;
    if (matchingController?.linked_pill_id) {
      matchingPill = pills.find(p => p.pill_id === matchingController!.linked_pill_id) || null;
    }
    if (matchingController) return { pill: matchingPill, controller: matchingController };
  }

  // 3. paired_device_id matching — find pill whose hardware pairing matches a controller,
  //    and whose temperature matches THIS brew (±3°C)
  for (const pill of pills) {
    if (!pill.paired_device_id) continue;
    const pairedController = controllers.find(c => c.controller_id === pill.paired_device_id);
    if (!pairedController) continue;
    const pillTemp = pairedController.pill_temp;
    if (pillTemp !== null && Math.abs(pillTemp - brew.currentTemp) <= 3) {
      return { pill, controller: pairedController };
    }
  }

  // 4. Color name matching (with synonym groups)
  const brewNameLower = brew.name.toLowerCase();
  const brewColors = colorKeywords.filter(color => brewNameLower.includes(color));
  const expandedBrewColors = expandColorGroup(brewColors);

  if (expandedBrewColors.length > 0) {
    matchingController = controllers.find(ctrl => {
      const ctrlNameLower = ctrl.name.toLowerCase();
      return expandedBrewColors.some(color => ctrlNameLower.includes(color));
    }) || null;
  }

  if (matchingController && matchingController.linked_pill_id) {
    matchingPill = pills.find(p => p.pill_id === matchingController!.linked_pill_id) || null;
  }

  // 5. Temperature matching fallback (±3°C tolerance)
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
