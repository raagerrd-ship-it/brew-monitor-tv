
CREATE TABLE public.pill_sg_calibration (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pill_id text NOT NULL UNIQUE,
  anchor_sg numeric,
  anchor_temp numeric,
  anchor_recorded_at timestamptz,
  status text NOT NULL DEFAULT 'idle',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pill_sg_calibration ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view pill sg calibration" ON public.pill_sg_calibration FOR SELECT USING (true);
CREATE POLICY "Service role can manage pill sg calibration" ON public.pill_sg_calibration FOR ALL USING (true) WITH CHECK (true);
