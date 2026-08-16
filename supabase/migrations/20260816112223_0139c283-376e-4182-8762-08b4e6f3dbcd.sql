ALTER TABLE public.pi_setpoint ALTER COLUMN target_temp DROP NOT NULL;
ALTER TABLE public.pi_setpoint ADD COLUMN IF NOT EXISTS commanded_at timestamptz NULL;
ALTER TABLE public.pi_live_state ADD COLUMN IF NOT EXISTS target_source text NULL;
ALTER TABLE public.pi_live_state ADD COLUMN IF NOT EXISTS effective_target numeric NULL;
ALTER TABLE public.pi_live_state ADD COLUMN IF NOT EXISTS paused_at timestamptz NULL;