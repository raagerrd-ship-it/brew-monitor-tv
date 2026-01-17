export interface BrewEvent {
  id: string;
  brew_id: string;
  event_type: string;
  event_date: string;
  notes: string | null;
}

export interface FermentationSessionData {
  id: string;
  profile_id: string;
  controller_id: string;
  status: string;
  current_step_index: number;
  step_started_at: string;
  started_at: string;
  step_start_temp: number | null;
  profile_name: string;
  steps: FermentationStepData[];
  controller_current_temp: number | null;
  controller_target_temp: number | null;
}

export interface FermentationStepData {
  id: string;
  step_type: string;
  target_temp: number | null;
  duration_hours: number | null;
  ramp_type: string | null;
  gravity_stable_days: number | null;
  target_sg: number | null;
  sg_comparison: string | null;
  step_order: number;
}

export interface BrewData {
  id: string;
  batch_id: string;
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
}

export interface PillData {
  id: string;
  pill_id: string;
  name: string;
  color: string;
  battery_level: number;
  last_update: string | null;
}

export interface TempController {
  id: string;
  controller_id: string;
  name: string;
  current_temp: number | null;
  pill_temp: number | null;
  target_temp: number | null;
  last_update: string | null;
  min_target_temp: number | null;
  max_target_temp: number | null;
  cooling_enabled: boolean | null;
  heating_enabled: boolean | null;
  heating_utilisation: number | null;
  linked_pill_id: string | null;
}
