-- Create table for auto cooling adjustment settings
CREATE TABLE IF NOT EXISTS public.auto_cooling_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  check_interval_minutes integer NOT NULL DEFAULT 60,
  temp_reduction_degrees numeric NOT NULL DEFAULT 2.0,
  max_diff_from_lowest numeric NOT NULL DEFAULT 10.0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create table for temperature history tracking
CREATE TABLE IF NOT EXISTS public.temp_controller_history (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  controller_id text NOT NULL,
  current_temp numeric NOT NULL,
  target_temp numeric NOT NULL,
  cooling_enabled boolean NOT NULL,
  recorded_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_temp_history_controller_recorded 
  ON public.temp_controller_history(controller_id, recorded_at DESC);

-- Enable RLS
ALTER TABLE public.auto_cooling_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.temp_controller_history ENABLE ROW LEVEL SECURITY;

-- RLS policies for auto_cooling_settings
CREATE POLICY "Anyone can view auto cooling settings"
  ON public.auto_cooling_settings
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can update auto cooling settings"
  ON public.auto_cooling_settings
  FOR UPDATE
  USING (true);

CREATE POLICY "Anyone can insert auto cooling settings"
  ON public.auto_cooling_settings
  FOR INSERT
  WITH CHECK (true);

-- RLS policies for temp_controller_history
CREATE POLICY "Anyone can view temp history"
  ON public.temp_controller_history
  FOR SELECT
  USING (true);

CREATE POLICY "Service role can insert temp history"
  ON public.temp_controller_history
  FOR INSERT
  WITH CHECK (true);

-- Insert default settings
INSERT INTO public.auto_cooling_settings (enabled, check_interval_minutes, temp_reduction_degrees, max_diff_from_lowest)
VALUES (false, 60, 2.0, 10.0)
ON CONFLICT DO NOTHING;

-- Create trigger for updated_at
CREATE TRIGGER update_auto_cooling_settings_updated_at
  BEFORE UPDATE ON public.auto_cooling_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();