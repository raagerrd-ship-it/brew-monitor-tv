-- AI audit log table
CREATE TABLE public.ai_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  duration_ms integer NOT NULL DEFAULT 0,
  model text NOT NULL DEFAULT 'google/gemini-3-flash-preview',
  prompt_summary text,
  analysis text NOT NULL,
  actions_taken jsonb NOT NULL DEFAULT '[]'::jsonb,
  parameters_changed jsonb NOT NULL DEFAULT '[]'::jsonb,
  anomalies_detected jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb
);

ALTER TABLE public.ai_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view AI audit logs" ON public.ai_audit_log FOR SELECT USING (true);
CREATE POLICY "Service role can insert AI audit logs" ON public.ai_audit_log FOR INSERT WITH CHECK (true);
