
-- Delta history: records pill vs controller temp over time
CREATE TABLE public.temp_delta_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  controller_id TEXT NOT NULL,
  pill_temp NUMERIC NOT NULL,
  controller_temp NUMERIC NOT NULL,
  delta NUMERIC NOT NULL,
  recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for querying recent deltas per controller
CREATE INDEX idx_temp_delta_history_controller_recorded 
  ON public.temp_delta_history (controller_id, recorded_at DESC);

ALTER TABLE public.temp_delta_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view delta history"
  ON public.temp_delta_history FOR SELECT USING (true);

CREATE POLICY "Service role can insert delta history"
  ON public.temp_delta_history FOR INSERT WITH CHECK (true);

-- Delta alerts: warnings when delta exceeds threshold
CREATE TABLE public.temp_delta_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  controller_id TEXT NOT NULL,
  delta NUMERIC NOT NULL,
  alert_type TEXT NOT NULL DEFAULT 'high_delta',
  acknowledged BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_temp_delta_alerts_controller_ack 
  ON public.temp_delta_alerts (controller_id, acknowledged);

ALTER TABLE public.temp_delta_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view delta alerts"
  ON public.temp_delta_alerts FOR SELECT USING (true);

CREATE POLICY "Service role can insert delta alerts"
  ON public.temp_delta_alerts FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update delta alerts"
  ON public.temp_delta_alerts FOR UPDATE USING (true);

CREATE POLICY "Anyone can delete delta alerts"
  ON public.temp_delta_alerts FOR DELETE USING (true);

-- Add threshold setting to auto_cooling_settings
ALTER TABLE public.auto_cooling_settings 
  ADD COLUMN delta_alert_threshold NUMERIC NOT NULL DEFAULT 2.0;
