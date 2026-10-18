CREATE TABLE public.pi_profile_library (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  payload jsonb NOT NULL,
  published_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.pi_profile_library TO service_role;
REVOKE ALL ON public.pi_profile_library FROM anon, authenticated;
ALTER TABLE public.pi_profile_library ENABLE ROW LEVEL SECURITY;