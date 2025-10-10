-- Create sync settings table
CREATE TABLE IF NOT EXISTS public.sync_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sync_interval INTEGER NOT NULL DEFAULT 60, -- seconds (60 = 1 minute)
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.sync_settings ENABLE ROW LEVEL SECURITY;

-- Create policies for sync settings (public read/write since it's a single-user app)
CREATE POLICY "Anyone can view sync settings" 
ON public.sync_settings 
FOR SELECT 
USING (true);

CREATE POLICY "Anyone can update sync settings" 
ON public.sync_settings 
FOR UPDATE 
USING (true);

CREATE POLICY "Anyone can insert sync settings" 
ON public.sync_settings 
FOR INSERT 
WITH CHECK (true);

-- Insert default settings
INSERT INTO public.sync_settings (sync_interval) VALUES (60)
ON CONFLICT DO NOTHING;

-- Add trigger for timestamps
CREATE TRIGGER update_sync_settings_updated_at
BEFORE UPDATE ON public.sync_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();