CREATE TABLE public.pi_learned_params (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  controller_id text NOT NULL,
  mode text NOT NULL,
  parameter_name text NOT NULL,
  value numeric NOT NULL,
  samples integer NOT NULL DEFAULT 0,
  param_updated_at double precision NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (controller_id, mode, parameter_name)
);

CREATE TABLE public.pi_learned_params_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  controller_id text NOT NULL,
  mode text NOT NULL,
  parameter_name text NOT NULL,
  value numeric NOT NULL,
  samples integer NOT NULL DEFAULT 0,
  param_updated_at double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pi_learned_hist ON public.pi_learned_params_history (controller_id, mode, parameter_name, created_at DESC);

GRANT SELECT ON public.pi_learned_params TO authenticated, anon;
GRANT ALL ON public.pi_learned_params TO service_role;
GRANT SELECT ON public.pi_learned_params_history TO authenticated, anon;
GRANT ALL ON public.pi_learned_params_history TO service_role;

ALTER TABLE public.pi_learned_params ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pi_learned_params_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read learned params" ON public.pi_learned_params FOR SELECT USING (true);
CREATE POLICY "Anyone can read learned params history" ON public.pi_learned_params_history FOR SELECT USING (true);

CREATE TRIGGER update_pi_learned_params_updated_at
BEFORE UPDATE ON public.pi_learned_params
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();