ALTER TABLE public.rapt_temp_controllers
  ADD COLUMN IF NOT EXISTS pwm_off_expected_target numeric,
  ADD COLUMN IF NOT EXISTS pwm_off_sent_at timestamp with time zone;