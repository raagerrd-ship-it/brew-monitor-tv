
CREATE TABLE public.plug_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command text NOT NULL CHECK (command IN ('on','off','restart')),
  source text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz
);

GRANT SELECT, INSERT, UPDATE ON public.plug_commands TO anon, authenticated;
GRANT ALL ON public.plug_commands TO service_role;

ALTER TABLE public.plug_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view plug commands"
  ON public.plug_commands FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert plug commands"
  ON public.plug_commands FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update plug commands"
  ON public.plug_commands FOR UPDATE
  USING (true);

CREATE INDEX idx_plug_commands_pending ON public.plug_commands (created_at)
  WHERE status = 'pending';

CREATE TABLE public.plug_state (
  id int PRIMARY KEY DEFAULT 1,
  is_on boolean,
  updated_at timestamptz,
  CONSTRAINT plug_state_singleton CHECK (id = 1)
);

GRANT SELECT ON public.plug_state TO anon, authenticated;
GRANT ALL ON public.plug_state TO service_role;

ALTER TABLE public.plug_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view plug state"
  ON public.plug_state FOR SELECT
  USING (true);

INSERT INTO public.plug_state (id, is_on, updated_at) VALUES (1, NULL, NULL);
