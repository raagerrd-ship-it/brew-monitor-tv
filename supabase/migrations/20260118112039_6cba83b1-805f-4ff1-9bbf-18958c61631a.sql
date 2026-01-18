-- Table for storing settings for users authenticated against external Supabase
CREATE TABLE public.external_user_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_user_id text NOT NULL UNIQUE,
  timer_tv_mode_only boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.external_user_settings ENABLE ROW LEVEL SECURITY;

-- Anyone can view settings (needed for TV mode check)
CREATE POLICY "Anyone can view external user settings"
ON public.external_user_settings
FOR SELECT
USING (true);

-- Anyone can insert their own settings
CREATE POLICY "Anyone can insert external user settings"
ON public.external_user_settings
FOR INSERT
WITH CHECK (true);

-- Anyone can update settings
CREATE POLICY "Anyone can update external user settings"
ON public.external_user_settings
FOR UPDATE
USING (true);

-- Trigger for updated_at
CREATE TRIGGER update_external_user_settings_updated_at
BEFORE UPDATE ON public.external_user_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();