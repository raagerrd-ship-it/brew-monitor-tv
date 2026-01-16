-- Create fermentation_profiles table
CREATE TABLE public.fermentation_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.fermentation_profiles ENABLE ROW LEVEL SECURITY;

-- RLS policies for fermentation_profiles
CREATE POLICY "Anyone can view fermentation profiles"
ON public.fermentation_profiles
FOR SELECT
USING (true);

CREATE POLICY "Authenticated users can insert fermentation profiles"
ON public.fermentation_profiles
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update fermentation profiles"
ON public.fermentation_profiles
FOR UPDATE
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete fermentation profiles"
ON public.fermentation_profiles
FOR DELETE
USING (auth.uid() IS NOT NULL);

-- Create trigger for updated_at
CREATE TRIGGER update_fermentation_profiles_updated_at
BEFORE UPDATE ON public.fermentation_profiles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create fermentation_profile_steps table
CREATE TABLE public.fermentation_profile_steps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.fermentation_profiles(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  step_type TEXT NOT NULL CHECK (step_type IN ('ramp', 'hold', 'wait_for_gravity_stable', 'wait_for_sg', 'wait_for_temp')),
  target_temp NUMERIC,
  duration_hours INTEGER,
  ramp_type TEXT CHECK (ramp_type IN ('linear', 'immediate')),
  gravity_stable_days INTEGER,
  gravity_threshold NUMERIC DEFAULT 0.001,
  target_sg NUMERIC,
  sg_comparison TEXT CHECK (sg_comparison IN ('at_or_below', 'at_or_above')),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.fermentation_profile_steps ENABLE ROW LEVEL SECURITY;

-- RLS policies for fermentation_profile_steps
CREATE POLICY "Anyone can view fermentation profile steps"
ON public.fermentation_profile_steps
FOR SELECT
USING (true);

CREATE POLICY "Authenticated users can insert fermentation profile steps"
ON public.fermentation_profile_steps
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update fermentation profile steps"
ON public.fermentation_profile_steps
FOR UPDATE
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete fermentation profile steps"
ON public.fermentation_profile_steps
FOR DELETE
USING (auth.uid() IS NOT NULL);

-- Create trigger for updated_at
CREATE TRIGGER update_fermentation_profile_steps_updated_at
BEFORE UPDATE ON public.fermentation_profile_steps
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create fermentation_sessions table
CREATE TABLE public.fermentation_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.fermentation_profiles(id) ON DELETE RESTRICT,
  brew_id UUID REFERENCES public.brew_readings(id) ON DELETE SET NULL,
  controller_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'paused', 'completed', 'cancelled')),
  current_step_index INTEGER NOT NULL DEFAULT 0,
  step_started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.fermentation_sessions ENABLE ROW LEVEL SECURITY;

-- RLS policies for fermentation_sessions
CREATE POLICY "Anyone can view fermentation sessions"
ON public.fermentation_sessions
FOR SELECT
USING (true);

CREATE POLICY "Authenticated users can insert fermentation sessions"
ON public.fermentation_sessions
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update fermentation sessions"
ON public.fermentation_sessions
FOR UPDATE
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete fermentation sessions"
ON public.fermentation_sessions
FOR DELETE
USING (auth.uid() IS NOT NULL);

-- Create trigger for updated_at
CREATE TRIGGER update_fermentation_sessions_updated_at
BEFORE UPDATE ON public.fermentation_sessions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create fermentation_step_log table
CREATE TABLE public.fermentation_step_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.fermentation_sessions(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('started', 'temp_adjusted', 'condition_met', 'completed', 'paused', 'resumed', 'cancelled')),
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.fermentation_step_log ENABLE ROW LEVEL SECURITY;

-- RLS policies for fermentation_step_log
CREATE POLICY "Anyone can view fermentation step log"
ON public.fermentation_step_log
FOR SELECT
USING (true);

CREATE POLICY "Service role can insert fermentation step log"
ON public.fermentation_step_log
FOR INSERT
WITH CHECK (true);

-- Add index for faster queries
CREATE INDEX idx_fermentation_sessions_status ON public.fermentation_sessions(status);
CREATE INDEX idx_fermentation_sessions_controller ON public.fermentation_sessions(controller_id);
CREATE INDEX idx_fermentation_profile_steps_profile ON public.fermentation_profile_steps(profile_id);
CREATE INDEX idx_fermentation_step_log_session ON public.fermentation_step_log(session_id);

-- Enable realtime for sessions
ALTER PUBLICATION supabase_realtime ADD TABLE public.fermentation_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.fermentation_step_log;