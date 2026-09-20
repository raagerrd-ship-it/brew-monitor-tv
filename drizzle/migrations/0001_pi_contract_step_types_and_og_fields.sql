ALTER TABLE public.fermentation_profile_steps DROP CONSTRAINT IF EXISTS fermentation_profile_steps_step_type_check;
ALTER TABLE public.fermentation_profile_steps ADD CONSTRAINT fermentation_profile_steps_step_type_check CHECK (step_type IN ('hold','ramp','wait_for_temp','wait_for_gravity_stable','wait_for_sg','wait_for_acknowledgement','wait_for_pitch','diacetyl_rest','gradual_ramp','smart_cold_crash'));

ALTER TABLE public.brew_status
  ADD COLUMN IF NOT EXISTS og_measured_at timestamptz,
  ADD COLUMN IF NOT EXISTS fg_expected numeric;