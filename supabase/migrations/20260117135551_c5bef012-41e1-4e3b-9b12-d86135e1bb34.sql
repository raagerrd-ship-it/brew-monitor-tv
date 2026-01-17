-- Create a table to store auto-cooling decision logs
CREATE TABLE public.auto_cooling_decision_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  duration_ms INTEGER NOT NULL,
  decision_count INTEGER NOT NULL,
  decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
  final_result TEXT NOT NULL,
  adjustment_made BOOLEAN NOT NULL DEFAULT false
);

-- Enable Row Level Security
ALTER TABLE public.auto_cooling_decision_logs ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Anyone can view decision logs" 
ON public.auto_cooling_decision_logs 
FOR SELECT 
USING (true);

CREATE POLICY "Service role can insert decision logs" 
ON public.auto_cooling_decision_logs 
FOR INSERT 
WITH CHECK (true);

-- Create index for faster queries by created_at
CREATE INDEX idx_auto_cooling_decision_logs_created_at 
ON public.auto_cooling_decision_logs(created_at DESC);

-- Add to realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.auto_cooling_decision_logs;