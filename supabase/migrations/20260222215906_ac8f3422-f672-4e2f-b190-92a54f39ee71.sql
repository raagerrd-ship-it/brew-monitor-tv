-- Table to store learned compensation baselines per controller and fermentation phase
-- Delta buckets represent fermentation activity: high delta = active fermentation, low = calm/finished
CREATE TABLE public.controller_learned_compensation (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  controller_id TEXT NOT NULL,
  delta_bucket TEXT NOT NULL, -- 'low' (<1.5°), 'medium' (1.5-3°), 'high' (>3°)
  learned_pi_correction NUMERIC NOT NULL DEFAULT 0,
  convergence_count INTEGER NOT NULL DEFAULT 0,
  last_converged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(controller_id, delta_bucket)
);

-- Enable RLS
ALTER TABLE public.controller_learned_compensation ENABLE ROW LEVEL SECURITY;

-- Service role can manage
CREATE POLICY "Service role can manage learned compensation"
  ON public.controller_learned_compensation
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Anyone can view
CREATE POLICY "Anyone can view learned compensation"
  ON public.controller_learned_compensation
  FOR SELECT
  USING (true);
