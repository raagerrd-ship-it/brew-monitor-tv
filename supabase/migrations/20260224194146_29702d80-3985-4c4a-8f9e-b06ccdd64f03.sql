
-- Create brew_fermentation_metrics table
-- Stores computed fermentation analytics per brew, updated each automation cycle
CREATE TABLE public.brew_fermentation_metrics (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brew_id uuid NOT NULL REFERENCES public.brew_readings(id) ON DELETE CASCADE,
  fermentation_phase text NOT NULL DEFAULT 'unknown',
  activity_score numeric NOT NULL DEFAULT 0,
  sg_rate_per_hour numeric NOT NULL DEFAULT 0,
  eta_to_fg_hours numeric,
  peak_delta numeric NOT NULL DEFAULT 0,
  ready_to_crash boolean NOT NULL DEFAULT false,
  ready_to_crash_at timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT valid_phase CHECK (fermentation_phase IN ('unknown', 'lag', 'exponential', 'stationary', 'declining')),
  CONSTRAINT valid_activity_score CHECK (activity_score >= 0 AND activity_score <= 100)
);

-- One metrics row per brew
CREATE UNIQUE INDEX idx_brew_fermentation_metrics_brew_id ON public.brew_fermentation_metrics(brew_id);

-- Enable RLS
ALTER TABLE public.brew_fermentation_metrics ENABLE ROW LEVEL SECURITY;

-- Anyone can read metrics
CREATE POLICY "Anyone can view fermentation metrics"
  ON public.brew_fermentation_metrics FOR SELECT USING (true);

-- Service role can insert/update
CREATE POLICY "Service role can insert fermentation metrics"
  ON public.brew_fermentation_metrics FOR INSERT WITH CHECK (true);

CREATE POLICY "Service role can update fermentation metrics"
  ON public.brew_fermentation_metrics FOR UPDATE USING (true);

-- Add diacetyl_rest columns to fermentation_profile_steps
ALTER TABLE public.fermentation_profile_steps
  ADD COLUMN IF NOT EXISTS attenuation_trigger numeric,
  ADD COLUMN IF NOT EXISTS temp_increase numeric;
