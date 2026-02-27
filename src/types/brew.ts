// Re-export fermentation DTO types for backward compatibility
export type { FermentationSessionData, FermentationStepData } from "./fermentation";
import type { FermentationSessionData } from "./fermentation";

export interface BrewEvent {
  id: string;
  brew_id: string;
  event_type: string;
  event_date: string;
  notes: string | null;
}

export interface BrewData {
  id: string;
  batch_id: string;
  share_id: string | null;
  name: string;
  style: string;
  batchNumber: string;
  status: string;
  currentSG: number;
  currentTemp: number;
  attenuation: number;
  abv: number;
  originalGravity: number;
  finalGravity: number;
  lastUpdate: string;
  lastUpdateRaw: string | null;
  battery: number | null;
  sgData: Array<{ date: string; value: number; temp: number }>;
  fermentationRate: number | null;
  coldcrashAcknowledged: boolean;
  events: BrewEvent[];
  linked_controller_id: string | null;
  linked_pill_id: string | null;
  fermentationSession: FermentationSessionData | null;
  label_image_url: string | null;
  description: string | null;
  overshootReason: string | null;
  originalTarget: number | null;
  fermentationTrend?: {
    rate6h: number | null;
    rate12h: number | null;
    trend: 'rising' | 'falling' | 'stable' | null;
  };
  fermentationMetrics?: {
    fermentation_phase: string;
    activity_score: number;
    sg_rate_per_hour: number;
    eta_to_fg_hours: number | null;
    peak_delta: number;
    ready_to_crash: boolean;
  } | null;
}

export interface PillData {
  id: string;
  pill_id: string;
  name: string;
  color: string;
  battery_level: number;
  last_update: string | null;
  paired_device_id?: string | null;
}

export interface TempController {
  id: string;
  controller_id: string;
  name: string;
  current_temp: number | null;
  pill_temp: number | null;
  target_temp: number | null;
  profile_target_temp?: number | null;
  last_update: string | null;
  min_target_temp: number | null;
  max_target_temp: number | null;
  cooling_enabled: boolean | null;
  heating_enabled: boolean | null;
  heating_utilisation: number | null;
  linked_pill_id: string | null;
  cooling_hysteresis: number | null;
  heating_hysteresis: number | null;
  cooling_run_time: number | null;
  cooling_starts: number | null;
  heating_run_time: number | null;
  heating_starts: number | null;
}
