CREATE TABLE public.pi_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL,
  command text NOT NULL,
  kind text,
  payload jsonb,
  racked_at timestamptz,
  issued_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  result text,
  brew_id text,
  controller_id text
);

GRANT SELECT, INSERT ON public.pi_commands TO authenticated;
GRANT ALL ON public.pi_commands TO service_role;

ALTER TABLE public.pi_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read commands"
  ON public.pi_commands FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can queue commands"
  ON public.pi_commands FOR INSERT TO authenticated WITH CHECK (true);

CREATE INDEX pi_commands_pending_idx ON public.pi_commands (issued_at) WHERE applied_at IS NULL;