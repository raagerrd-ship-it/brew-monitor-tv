CREATE TABLE public.brew_day_session (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  active boolean NOT NULL DEFAULT false,
  recipe_name text,
  step_id text,
  step_kind text,
  step_title text,
  target_temp_c numeric,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.brew_day_session TO anon, authenticated;
GRANT ALL ON public.brew_day_session TO service_role;
ALTER TABLE public.brew_day_session ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view brew day" ON public.brew_day_session FOR SELECT USING (true);
ALTER PUBLICATION supabase_realtime ADD TABLE public.brew_day_session;