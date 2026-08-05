ALTER TABLE public.rapt_temp_controllers
  DROP COLUMN IF EXISTS dual_sensor_enabled,
  DROP COLUMN IF EXISTS preferred_sensor;