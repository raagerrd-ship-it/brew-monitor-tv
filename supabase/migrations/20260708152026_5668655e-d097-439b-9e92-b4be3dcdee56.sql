ALTER TABLE public.rapt_temp_controllers
  ADD COLUMN IF NOT EXISTS pid_version text NOT NULL DEFAULT 'v5';