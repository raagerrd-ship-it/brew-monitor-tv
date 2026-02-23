
-- Create rapt_outage_log table
CREATE TABLE public.rapt_outage_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  outage_start TIMESTAMP WITH TIME ZONE NOT NULL,
  outage_end TIMESTAMP WITH TIME ZONE NOT NULL,
  duration_seconds INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.rapt_outage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view outage log" ON public.rapt_outage_log FOR SELECT USING (true);
CREATE POLICY "Service role can insert outage log" ON public.rapt_outage_log FOR INSERT WITH CHECK (true);

-- Add last_successful_rapt_sync_at to sync_settings
ALTER TABLE public.sync_settings ADD COLUMN last_successful_rapt_sync_at TIMESTAMP WITH TIME ZONE;
