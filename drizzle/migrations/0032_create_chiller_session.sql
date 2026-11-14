CREATE TABLE public.chiller_session (
  id text PRIMARY KEY DEFAULT 'glycol',
  kind text,
  active boolean NOT NULL DEFAULT false,
  level text,
  advice text,
  started_at timestamptz,
  ends_by timestamptz,
  ended_at timestamptz,
  bath_c real,
  bath_from_c real,
  stop_c real,
  rate_c_min real,
  eta_at timestamptz,
  compressor_on boolean NOT NULL DEFAULT false,
  after_runs_done int,
  lift_pct int,
  result text,
  chiller_locked boolean NOT NULL DEFAULT false,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.chiller_session TO anon, authenticated;
GRANT ALL ON public.chiller_session TO service_role;
ALTER TABLE public.chiller_session ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view chiller session" ON public.chiller_session FOR SELECT USING (true);
ALTER PUBLICATION supabase_realtime ADD TABLE public.chiller_session;