CREATE TABLE public.vapid_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_key_jwk jsonb NOT NULL,
  private_key_jwk jsonb NOT NULL,
  public_key_base64 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vapid_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage vapid keys"
  ON public.vapid_keys FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can view vapid keys"
  ON public.vapid_keys FOR SELECT
  USING (true);