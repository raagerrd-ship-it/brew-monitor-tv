CREATE TABLE public.pi_setpoint (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  controller_id text NOT NULL UNIQUE,
  target_temp numeric NOT NULL,
  mode_allowed text NOT NULL DEFAULT 'both',
  max_duty_pct numeric NOT NULL DEFAULT 100,
  pwm_period_s integer NOT NULL DEFAULT 180,
  min_on_s integer NOT NULL DEFAULT 5,
  min_off_s integer NOT NULL DEFAULT 5,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  params_version integer NOT NULL DEFAULT 0,
  set_at timestamptz NOT NULL DEFAULT now(),
  set_by text NOT NULL DEFAULT 'cloud',
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pi_setpoint TO authenticated;
GRANT ALL ON public.pi_setpoint TO service_role;
ALTER TABLE public.pi_setpoint ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage setpoints" ON public.pi_setpoint FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.pi_live_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  controller_id text NOT NULL UNIQUE,
  actual_temp numeric,
  target_temp numeric,
  mode text,
  duty_pct numeric NOT NULL DEFAULT 0,
  cooling_relay_on boolean NOT NULL DEFAULT false,
  heating_relay_on boolean NOT NULL DEFAULT false,
  glycol_temp numeric,
  pid_terms jsonb,
  constraints_hit text[],
  sensor_source text,
  last_heartbeat timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.pi_live_state TO authenticated;
GRANT ALL ON public.pi_live_state TO service_role;
ALTER TABLE public.pi_live_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read live state" ON public.pi_live_state FOR SELECT TO authenticated USING (true);

ALTER TABLE public.rapt_temp_controllers ADD COLUMN IF NOT EXISTS actuation text NOT NULL DEFAULT 'rapt';

CREATE TRIGGER update_pi_setpoint_updated_at BEFORE UPDATE ON public.pi_setpoint FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_pi_live_state_updated_at BEFORE UPDATE ON public.pi_live_state FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.pi_live_state;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pi_setpoint;