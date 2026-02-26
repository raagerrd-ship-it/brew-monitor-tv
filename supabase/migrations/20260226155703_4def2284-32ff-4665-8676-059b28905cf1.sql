-- Update allowed fermentation step types to include diacetyl_rest and gradual_ramp
ALTER TABLE public.fermentation_profile_steps
DROP CONSTRAINT IF EXISTS fermentation_profile_steps_step_type_check;

ALTER TABLE public.fermentation_profile_steps
ADD CONSTRAINT fermentation_profile_steps_step_type_check
CHECK (
  step_type = ANY (
    ARRAY[
      'hold'::text,
      'ramp'::text,
      'wait_for_temp'::text,
      'wait_for_gravity_stable'::text,
      'wait_for_sg'::text,
      'wait_for_acknowledgement'::text,
      'diacetyl_rest'::text,
      'gradual_ramp'::text
    ]
  )
);