CREATE TABLE public.rapt_token_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.rapt_token_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage rapt token cache"
  ON public.rapt_token_cache FOR ALL
  USING (true) WITH CHECK (true);
