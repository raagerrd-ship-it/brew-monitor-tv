CREATE TABLE public.pi_health (
  id INT PRIMARY KEY DEFAULT 1,
  last_seen TIMESTAMPTZ,
  undervoltage_now BOOLEAN,
  undervoltage_ever BOOLEAN,
  throttled_hex TEXT,
  temp_c NUMERIC,
  uptime_sec BIGINT,
  load1 NUMERIC,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.pi_health TO anon, authenticated;
GRANT ALL ON public.pi_health TO service_role;

ALTER TABLE public.pi_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pi_health readable by all" ON public.pi_health FOR SELECT USING (true);
CREATE POLICY "pi_health updatable by all" ON public.pi_health FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "pi_health insertable by all" ON public.pi_health FOR INSERT WITH CHECK (true);

INSERT INTO public.pi_health (id) VALUES (1) ON CONFLICT (id) DO NOTHING;