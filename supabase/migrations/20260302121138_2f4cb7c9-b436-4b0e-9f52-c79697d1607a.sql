
CREATE TABLE public.cooler_margin_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  controller_id text NOT NULL,
  temp_bucket text NOT NULL,
  margin_value numeric NOT NULL,
  max_effective numeric,
  utilization numeric,
  cooling_rate numeric,
  sample_count integer NOT NULL DEFAULT 0,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cooler_margin_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view margin history" ON public.cooler_margin_history FOR SELECT USING (true);
CREATE POLICY "Service role can insert margin history" ON public.cooler_margin_history FOR INSERT WITH CHECK (true);
CREATE POLICY "Service role can delete margin history" ON public.cooler_margin_history FOR DELETE USING (true);

CREATE INDEX idx_cooler_margin_history_controller ON public.cooler_margin_history (controller_id, temp_bucket, recorded_at DESC);
