
CREATE POLICY "Anyone can update plug state"
  ON public.plug_state FOR UPDATE
  USING (id = 1)
  WITH CHECK (id = 1);

GRANT UPDATE ON public.plug_state TO anon, authenticated;
