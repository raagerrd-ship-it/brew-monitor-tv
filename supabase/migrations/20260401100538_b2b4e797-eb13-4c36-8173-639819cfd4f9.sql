
CREATE TABLE public.controller_outage_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  controller_id TEXT NOT NULL,
  controller_name TEXT NOT NULL,
  outage_start TIMESTAMP WITH TIME ZONE NOT NULL,
  outage_end TIMESTAMP WITH TIME ZONE,
  duration_seconds INTEGER,
  resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.controller_outage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view controller outage log"
  ON public.controller_outage_log FOR SELECT
  TO public USING (true);

CREATE POLICY "Service role can insert controller outage log"
  ON public.controller_outage_log FOR INSERT
  TO public WITH CHECK (true);

CREATE POLICY "Service role can update controller outage log"
  ON public.controller_outage_log FOR UPDATE
  TO public USING (true);

CREATE INDEX idx_controller_outage_log_controller_id ON public.controller_outage_log (controller_id);
CREATE INDEX idx_controller_outage_log_resolved ON public.controller_outage_log (resolved) WHERE resolved = false;
