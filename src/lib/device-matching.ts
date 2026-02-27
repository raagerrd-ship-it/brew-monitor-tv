import { BrewData, PillData, TempController } from "@/types/brew";
import { colorKeywords } from "./color-utils";

export interface DeviceMatch {
  pill: PillData | null;
  controller: TempController | null;
}

/**
 * Find matching pill and controller for a brew based on:
 * 1. Manual controller connection (linked_controller_id) - pill is automatically derived from controller
 * 2. Color name matching
 * 3. Temperature matching (±3°C tolerance)
 * 
 * Note: linked_pill_id on brew is deprecated - pill is now derived from controller's linked_pill_id
 */
export function findDevicesForBrew(
  brew: BrewData,
  pills: PillData[],
  controllers: TempController[]
): DeviceMatch {
  // First, check for manual controller connection
  if (brew.linked_controller_id) {
    const manualController = controllers.find(c => c.controller_id === brew.linked_controller_id) || null;
    
    if (manualController) {
      const linkedPill = manualController.linked_pill_id 
        ? pills.find(p => p.pill_id === manualController.linked_pill_id) || null
        : null;
      
      return { pill: linkedPill, controller: manualController };
    }
  }

  // Fallback to automatic matching
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

  // Try to match controller by color first
  if (brewColors.length > 0) {
    matchingController = controllers.find(ctrl => {
      const ctrlNameLower = ctrl.name.toLowerCase();
      return brewColors.some(color => ctrlNameLower.includes(color));
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
