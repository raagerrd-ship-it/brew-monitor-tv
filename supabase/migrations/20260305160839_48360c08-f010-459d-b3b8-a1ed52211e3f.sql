CREATE TABLE public.pending_rapt_retries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  controller_id text NOT NULL,
  target_temp numeric NOT NULL,
  reason text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.pending_rapt_retries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage retries" ON public.pending_rapt_retries
  FOR ALL USING (true) WITH CHECK (true);
