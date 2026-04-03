CREATE POLICY "Service role can delete ai audit logs"
ON public.ai_audit_log
FOR DELETE
TO public
USING (true);

CREATE POLICY "Service role can delete step logs"
ON public.fermentation_step_log
FOR DELETE
TO public
USING (true);

CREATE POLICY "Service role can delete outage logs"
ON public.rapt_outage_log
FOR DELETE
TO public
USING (true);