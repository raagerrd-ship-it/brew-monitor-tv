export type StepType = 'ramp' | 'hold' | 'wait_for_gravity_stable' | 'wait_for_sg' | 'wait_for_temp' | 'wait_for_acknowledgement' | 'diacetyl_rest' | 'gradual_ramp';
export type RampType = 'linear' | 'immediate';
export type SgComparison = 'at_or_below' | 'at_or_above';
export type SessionStatus = 'running' | 'paused' | 'completed' | 'cancelled';
export type LogAction = 'started' | 'temp_adjusted' | 'condition_met' | 'completed' | 'paused' | 'resumed' | 'cancelled' | 'acknowledged';

export interface FermentationProfile {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface FermentationProfileStep {
  id: string;
  profile_id: string;
  step_order: number;
  step_type: StepType;
  target_temp: number | null;
  duration_hours: number | null;
  ramp_type: RampType | null;
  gravity_stable_days: number | null;
  gravity_threshold: number | null;
  target_sg: number | null;
  sg_comparison: SgComparison | null;
  notes: string | null;
  attenuation_trigger: number | null;
  activity_trigger: number | null;
  temp_increase: number | null;
  min_ramp_hours: number | null;
  ramp_curve: string | null;
  created_at: string;
  updated_at: string;
}

export interface FermentationSession {
  id: string;
  profile_id: string;
  brew_id: string | null;
  controller_id: string;
  status: SessionStatus;
  current_step_index: number;
  step_started_at: string;
  step_start_temp: number | null;
  ramp_triggered_at: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FermentationStepLog {
  id: string;
  session_id: string;
  step_index: number;
  action: LogAction;
  details: Record<string, any>;
  created_at: string;
}

export const STEP_TYPE_LABELS: Record<StepType, string> = {
  'ramp': 'Temperaturrampa',
  'hold': 'Håll temperatur',
  'wait_for_gravity_stable': 'Vänta på stabil SG',
  'wait_for_sg': 'Vänta på SG-värde',
  'wait_for_temp': 'Vänta på temperatur',
  'wait_for_acknowledgement': 'Kvittering',
  'diacetyl_rest': 'Diacetylvila',
  'gradual_ramp': 'Smart diacetylvila',
};

export const RAMP_TYPE_LABELS: Record<RampType, string> = {
  'linear': 'Linjär',
  'immediate': 'Omedelbar',
};

export const SG_COMPARISON_LABELS: Record<SgComparison, string> = {
  'at_or_below': '≤ (lika med eller under)',
  'at_or_above': '≥ (lika med eller över)',
};

export const getStepTypeLabel = (stepType: string): string => {
  if (['hold', 'wait_for_gravity_stable', 'wait_for_sg', 'wait_for_temp'].includes(stepType)) {
    return 'Håll temperatur';
  }
  return STEP_TYPE_LABELS[stepType as StepType] ?? stepType;
};

export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  'running': 'Körs',
  'paused': 'Pausad',
  'completed': 'Klar',
  'cancelled': 'Avbruten',
};

// DTO types used for brew card display (joined/enriched data)
export interface FermentationSessionData {
  id: string;
  profile_id: string;
  controller_id: string;
  status: string;
  current_step_index: number;
  step_started_at: string;
  started_at: string;
  step_start_temp: number | null;
  ramp_triggered_at: string | null;
  profile_name: string;
  steps: FermentationStepData[];
  controller_current_temp: number | null;
  controller_target_temp: number | null;
  controller_profile_target_temp?: number | null;
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
  attenuation_trigger?: number | null;
  activity_trigger?: number | null;
  temp_increase?: number | null;
  gravity_threshold?: number | null;
  min_ramp_hours?: number | null;
  ramp_curve?: string | null;
}
