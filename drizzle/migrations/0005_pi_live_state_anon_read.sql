GRANT SELECT ON public.pi_live_state TO anon, authenticated;
CREATE POLICY "Public can read live state" ON public.pi_live_state FOR SELECT TO anon USING (true);