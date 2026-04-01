
-- Create shared_timer table (singleton pattern)
CREATE TABLE public.shared_timer (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  type text DEFAULT NULL,
  ends_at timestamp with time zone DEFAULT NULL,
  started_at timestamp with time zone DEFAULT NULL,
  total_ms integer DEFAULT 0,
  label text DEFAULT NULL,
  alert_text text DEFAULT NULL,
  alert_duration_sec integer DEFAULT 10,
  is_active boolean NOT NULL DEFAULT false,
  fired boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.shared_timer ENABLE ROW LEVEL SECURITY;

-- Public access policies (same pattern as other tables)
CREATE POLICY "Anyone can view shared timer"
  ON public.shared_timer FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert shared timer"
  ON public.shared_timer FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update shared timer"
  ON public.shared_timer FOR UPDATE
  USING (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.shared_timer;

-- Insert initial singleton row
INSERT INTO public.shared_timer (is_active) VALUES (false);
