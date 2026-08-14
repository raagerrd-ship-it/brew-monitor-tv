DROP POLICY IF EXISTS "Service role can insert delta history" ON public.temp_delta_history;
DROP POLICY IF EXISTS "Service role can delete delta history" ON public.temp_delta_history;
REVOKE INSERT, UPDATE, DELETE ON public.temp_delta_history FROM anon, authenticated;