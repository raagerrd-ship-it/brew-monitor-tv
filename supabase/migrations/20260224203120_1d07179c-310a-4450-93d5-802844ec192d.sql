
-- 1. Create pending_notifications table
CREATE TABLE public.pending_notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  read_at TIMESTAMP WITH TIME ZONE,
  brew_id UUID REFERENCES public.brew_readings(id),
  controller_id TEXT
);

-- Enable RLS
ALTER TABLE public.pending_notifications ENABLE ROW LEVEL SECURITY;

-- Policies: anyone can read, service role can insert
CREATE POLICY "Anyone can view notifications"
  ON public.pending_notifications FOR SELECT USING (true);

CREATE POLICY "Service role can insert notifications"
  ON public.pending_notifications FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update notifications"
  ON public.pending_notifications FOR UPDATE USING (true);

CREATE POLICY "Anyone can delete notifications"
  ON public.pending_notifications FOR DELETE USING (true);

-- Enable realtime for notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.pending_notifications;

-- 2. Add predicted_sg_curve to brew_fermentation_metrics
ALTER TABLE public.brew_fermentation_metrics
  ADD COLUMN predicted_sg_curve JSONB DEFAULT '[]'::jsonb;

-- 3. Add style_key to controller_learned_compensation
ALTER TABLE public.controller_learned_compensation
  ADD COLUMN style_key TEXT;

CREATE INDEX idx_learned_compensation_style_key
  ON public.controller_learned_compensation(style_key);
