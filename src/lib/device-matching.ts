import { BrewData, PillData, TempController } from "@/types/brew";

export interface DeviceMatch {
  pill: PillData | null;
  controller: TempController | null;
}

/**
 * Find matching pill and controller for a brew.
 *
 * Matching is ONLY based on:
 * 1. brew.linked_pill_id → pill → controller via pill.paired_device_id (RAPT hardware pairing)
 * 2. brew.linked_controller_id → controller → pill via controller.linked_pill_id
 *
 * No heuristics (color, temperature) — hardware pairing is the single source of truth.
 */
export function findDevicesForBrew(
  brew: BrewData,
  pills: PillData[],
  controllers: TempController[]
): DeviceMatch {
  let matchingPill: PillData | null = null;
  let matchingController: TempController | null = null;

  // 1. Brew → Pill → Controller (via RAPT hardware paired_device_id)
  if (brew.linked_pill_id) {
    matchingPill = pills.find(p => p.pill_id === brew.linked_pill_id) || null;
    if (matchingPill?.paired_device_id) {
      matchingController = controllers.find(c => c.controller_id === matchingPill!.paired_device_id) || null;
    }
    if (!matchingController) {
      matchingController = controllers.find(c => c.linked_pill_id === brew.linked_pill_id) || null;
    }
  }

  // 2. Brew → Controller → Pill (fallback if no pill link but controller link exists)
  if (!matchingController && brew.linked_controller_id) {
    matchingController = controllers.find(c => c.controller_id === brew.linked_controller_id) || null;
    if (matchingController?.linked_pill_id) {
      matchingPill = pills.find(p => p.pill_id === matchingController!.linked_pill_id) || null;
    }
  }

  // If pill_compensation is explicitly disabled, hide controller from frontend
  if (brew.pill_compensation === false) {
    return { pill: matchingPill, controller: null };
  }

  return { pill: matchingPill, controller: matchingController };
}
