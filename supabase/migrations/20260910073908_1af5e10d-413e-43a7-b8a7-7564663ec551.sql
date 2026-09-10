CREATE TABLE public.brew_status (
  source_id uuid PRIMARY KEY,
  updated_at timestamptz NOT NULL DEFAULT now(),
  phase text,
  temp_current_c numeric,
  temp_target_c numeric,
  step_started_at timestamptz,
  step_ends_at timestamptz,
  sg_current numeric,
  attenuation_pct numeric,
  fg_estimated_at timestamptz,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  og_measured numeric,
  fg_measured numeric,
  attenuation_final_pct numeric,
  fermentation_days numeric,
  time_in_band_pct numeric,
  temp_max_deviation_c numeric,
  steps_executed jsonb,
  final_report_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brew_status TO authenticated;
GRANT SELECT ON public.brew_status TO anon;
GRANT ALL ON public.brew_status TO service_role;

ALTER TABLE public.brew_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read brew status" ON public.brew_status FOR SELECT USING (true);
CREATE POLICY "Authenticated can insert brew status" ON public.brew_status FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update brew status" ON public.brew_status FOR UPDATE TO authenticated USING (true) WITH CHECK (true);