ALTER TABLE public.pi_setpoint ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.pi_setpoint DROP CONSTRAINT IF EXISTS pi_setpoint_mode_allowed_check;
ALTER TABLE public.pi_setpoint ADD CONSTRAINT pi_setpoint_mode_allowed_check CHECK (mode_allowed IN ('cooling','heating','both','none'));
ALTER TABLE public.pi_live_state ADD COLUMN IF NOT EXISTS enabled boolean;
ALTER TABLE public.pi_live_state ADD COLUMN IF NOT EXISTS mode_allowed text;