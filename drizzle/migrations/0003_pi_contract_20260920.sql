ALTER TABLE public.brew_status
  ADD COLUMN IF NOT EXISTS sessions jsonb,
  ADD COLUMN IF NOT EXISTS pitch jsonb,
  ADD COLUMN IF NOT EXISTS fermentation_start timestamptz,
  ADD COLUMN IF NOT EXISTS temp_max_deviation_fermenting_c numeric;

CREATE TABLE IF NOT EXISTS public.pi_telemetry_seen (
  controller_id text NOT NULL,
  kind text NOT NULL,
  seq bigint NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (controller_id, kind, seq)
);

GRANT ALL ON public.pi_telemetry_seen TO service_role;
ALTER TABLE public.pi_telemetry_seen ENABLE ROW LEVEL SECURITY;