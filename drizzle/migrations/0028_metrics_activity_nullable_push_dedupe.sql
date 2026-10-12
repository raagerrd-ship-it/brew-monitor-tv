ALTER TABLE public.brew_fermentation_metrics ALTER COLUMN activity_score DROP DEFAULT;
ALTER TABLE public.brew_fermentation_metrics ALTER COLUMN activity_score DROP NOT NULL;

CREATE TABLE public.push_sent_log (
  tag text PRIMARY KEY,
  sent_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.push_sent_log TO service_role;
ALTER TABLE public.push_sent_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.claim_push_tag(p_tag text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH c AS (
    INSERT INTO public.push_sent_log (tag, sent_at) VALUES (p_tag, now())
    ON CONFLICT (tag) DO UPDATE SET sent_at = now()
      WHERE public.push_sent_log.sent_at < now() - interval '10 minutes'
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM c);
$$;
REVOKE EXECUTE ON FUNCTION public.claim_push_tag(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_tag(text) TO service_role;