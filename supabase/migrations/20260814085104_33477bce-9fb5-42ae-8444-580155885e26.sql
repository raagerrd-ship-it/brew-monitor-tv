-- Server-only tables: remove public write policies (service_role bypasses RLS)
DROP POLICY IF EXISTS "Service role can insert AI audit logs" ON public.ai_audit_log;
DROP POLICY IF EXISTS "Service role can delete ai audit logs" ON public.ai_audit_log;

DROP POLICY IF EXISTS "Service role can insert fermentation metrics" ON public.brew_fermentation_metrics;
DROP POLICY IF EXISTS "Service role can update fermentation metrics" ON public.brew_fermentation_metrics;

DROP POLICY IF EXISTS "Service role can insert controller outage log" ON public.controller_outage_log;
DROP POLICY IF EXISTS "Service role can update controller outage log" ON public.controller_outage_log;

DROP POLICY IF EXISTS "Service role can manage fermentation learnings" ON public.fermentation_learnings;

DROP POLICY IF EXISTS "Service role can insert fermentation step log" ON public.fermentation_step_log;
DROP POLICY IF EXISTS "Service role can delete step logs" ON public.fermentation_step_log;

DROP POLICY IF EXISTS "Service role can manage pill sg calibration" ON public.pill_sg_calibration;

DROP POLICY IF EXISTS "Service role can insert outage log" ON public.rapt_outage_log;
DROP POLICY IF EXISTS "Service role can delete outage logs" ON public.rapt_outage_log;

DROP POLICY IF EXISTS "Service role can insert sonos now playing" ON public.sonos_now_playing;
DROP POLICY IF EXISTS "Service role can update sonos now playing" ON public.sonos_now_playing;

DROP POLICY IF EXISTS "Service role can insert temp history" ON public.temp_controller_history;
DROP POLICY IF EXISTS "Service role can insert temp controller history" ON public.temp_controller_history;
DROP POLICY IF EXISTS "Service role can delete temp history" ON public.temp_controller_history;
DROP POLICY IF EXISTS "Service role can delete temp controller history" ON public.temp_controller_history;

DROP POLICY IF EXISTS "Service role can insert temp delta history" ON public.temp_delta_history;
DROP POLICY IF EXISTS "Service role can delete temp delta history" ON public.temp_delta_history;

REVOKE INSERT, UPDATE, DELETE ON public.ai_audit_log, public.brew_fermentation_metrics,
  public.controller_outage_log, public.fermentation_learnings, public.fermentation_step_log,
  public.pill_sg_calibration, public.rapt_outage_log, public.sonos_now_playing,
  public.temp_controller_history, public.temp_delta_history FROM anon, authenticated;

-- UI-written tables: writes require an authenticated session
DROP POLICY IF EXISTS "Service role can insert brew data snapshots" ON public.brew_data_snapshots;
DROP POLICY IF EXISTS "Service role can delete brew data snapshots" ON public.brew_data_snapshots;
CREATE POLICY "Authenticated can delete brew data snapshots" ON public.brew_data_snapshots
  FOR DELETE TO authenticated USING (true);
REVOKE INSERT, UPDATE ON public.brew_data_snapshots FROM anon, authenticated;
REVOKE DELETE ON public.brew_data_snapshots FROM anon;

DROP POLICY IF EXISTS "Anyone can insert brew events" ON public.brew_events;
DROP POLICY IF EXISTS "Anyone can update brew events" ON public.brew_events;
DROP POLICY IF EXISTS "Anyone can delete brew events" ON public.brew_events;
CREATE POLICY "Authenticated can insert brew events" ON public.brew_events
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update brew events" ON public.brew_events
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete brew events" ON public.brew_events
  FOR DELETE TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON public.brew_events FROM anon;

DROP POLICY IF EXISTS "Service role can insert brew readings" ON public.brew_readings;
DROP POLICY IF EXISTS "Service role can update brew readings" ON public.brew_readings;
DROP POLICY IF EXISTS "Service role can delete brew readings" ON public.brew_readings;
CREATE POLICY "Authenticated can insert brew readings" ON public.brew_readings
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update brew readings" ON public.brew_readings
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete brew readings" ON public.brew_readings
  FOR DELETE TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON public.brew_readings FROM anon;

DROP POLICY IF EXISTS "Service role can insert temp controllers" ON public.rapt_temp_controllers;
DROP POLICY IF EXISTS "Service role can update temp controllers" ON public.rapt_temp_controllers;
DROP POLICY IF EXISTS "Service role can delete temp controllers" ON public.rapt_temp_controllers;
CREATE POLICY "Authenticated can insert temp controllers" ON public.rapt_temp_controllers
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update temp controllers" ON public.rapt_temp_controllers
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete temp controllers" ON public.rapt_temp_controllers
  FOR DELETE TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON public.rapt_temp_controllers FROM anon;

GRANT ALL ON public.ai_audit_log, public.brew_fermentation_metrics, public.controller_outage_log,
  public.fermentation_learnings, public.fermentation_step_log, public.pill_sg_calibration,
  public.rapt_outage_log, public.sonos_now_playing, public.temp_controller_history,
  public.temp_delta_history, public.brew_data_snapshots, public.brew_events,
  public.brew_readings, public.rapt_temp_controllers TO service_role;