CREATE TABLE public.external_auth_session (
  id text PRIMARY KEY DEFAULT 'default',
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.external_auth_session TO service_role;
ALTER TABLE public.external_auth_session ENABLE ROW LEVEL SECURITY;