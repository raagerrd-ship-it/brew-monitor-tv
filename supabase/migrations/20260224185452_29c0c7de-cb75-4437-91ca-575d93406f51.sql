
-- Table to track stall-boost outcomes: what boost was applied and what SG-rate resulted
CREATE TABLE public.stall_boost_outcomes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  controller_id TEXT NOT NULL,
  brew_id UUID REFERENCES public.brew_readings(id),
  boost_degrees NUMERIC NOT NULL,
  sg_rate_before NUMERIC NOT NULL,
  sg_rate_after NUMERIC,
  outcome TEXT, -- 'effective', 'ineffective', 'pending'
  evaluated_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.stall_boost_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view stall boost outcomes" ON public.stall_boost_outcomes FOR SELECT USING (true);
CREATE POLICY "Service role can insert stall boost outcomes" ON public.stall_boost_outcomes FOR INSERT WITH CHECK (true);
CREATE POLICY "Service role can update stall boost outcomes" ON public.stall_boost_outcomes FOR UPDATE USING (true);

-- Table to store per-controller learned parameters that improve over fermentations
CREATE TABLE public.fermentation_learnings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  controller_id TEXT NOT NULL,
  parameter_name TEXT NOT NULL,
  learned_value NUMERIC NOT NULL DEFAULT 0,
  sample_count INTEGER NOT NULL DEFAULT 0,
  last_updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(controller_id, parameter_name)
);

ALTER TABLE public.fermentation_learnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view fermentation learnings" ON public.fermentation_learnings FOR SELECT USING (true);
CREATE POLICY "Service role can manage fermentation learnings" ON public.fermentation_learnings FOR ALL USING (true) WITH CHECK (true);
