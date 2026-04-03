-- One-time cleanup
DELETE FROM temp_controller_history WHERE recorded_at < now() - interval '7 days';
DELETE FROM temp_delta_history WHERE recorded_at < now() - interval '7 days';
DELETE FROM auto_cooling_decision_logs WHERE created_at < now() - interval '24 hours';
DELETE FROM auto_cooling_adjustments WHERE created_at < now() - interval '30 days';

-- Add DELETE policies (skip auto_cooling_adjustments which already has one)
CREATE POLICY "Service role can delete temp history"
ON public.temp_controller_history
FOR DELETE
TO public
USING (true);

CREATE POLICY "Service role can delete delta history"
ON public.temp_delta_history
FOR DELETE
TO public
USING (true);

CREATE POLICY "Service role can delete decision logs"
ON public.auto_cooling_decision_logs
FOR DELETE
TO public
USING (true);