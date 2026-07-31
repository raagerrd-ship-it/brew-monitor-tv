-- 1. Plug control: remove anon write access
DROP POLICY IF EXISTS "plug_commands_anon_insert" ON public.plug_commands;
DROP POLICY IF EXISTS "plug_commands_anon_update" ON public.plug_commands;
DROP POLICY IF EXISTS "plug_state_anon_update" ON public.plug_state;

-- 2. Settings/state tables: restrict writes to authenticated
DROP POLICY IF EXISTS "Anyone can insert followed controllers" ON public.auto_cooling_followed_controllers;
DROP POLICY IF EXISTS "Anyone can delete followed controllers" ON public.auto_cooling_followed_controllers;
CREATE POLICY "Authenticated can insert followed controllers" ON public.auto_cooling_followed_controllers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can delete followed controllers" ON public.auto_cooling_followed_controllers FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Anyone can insert cached timer" ON public.cached_external_timer;
DROP POLICY IF EXISTS "Anyone can update cached timer" ON public.cached_external_timer;
CREATE POLICY "Authenticated can insert cached timer" ON public.cached_external_timer FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update cached timer" ON public.cached_external_timer FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can insert external user settings" ON public.external_user_settings;
DROP POLICY IF EXISTS "Anyone can update external user settings" ON public.external_user_settings;
CREATE POLICY "Authenticated can insert external user settings" ON public.external_user_settings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update external user settings" ON public.external_user_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can delete notifications" ON public.pending_notifications;
DROP POLICY IF EXISTS "Anyone can update notifications" ON public.pending_notifications;
DROP POLICY IF EXISTS "Service role can insert notifications" ON public.pending_notifications;
CREATE POLICY "Authenticated can delete notifications" ON public.pending_notifications FOR DELETE TO authenticated USING (true);
CREATE POLICY "Authenticated can update notifications" ON public.pending_notifications FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can update rapt pills" ON public.rapt_pills;
DROP POLICY IF EXISTS "Service role can delete pills" ON public.rapt_pills;
DROP POLICY IF EXISTS "Service role can insert pills" ON public.rapt_pills;
DROP POLICY IF EXISTS "Service role can update pills" ON public.rapt_pills;
DROP POLICY IF EXISTS "Service role can select pills" ON public.rapt_pills;
CREATE POLICY "Authenticated can insert rapt pills" ON public.rapt_pills FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update rapt pills" ON public.rapt_pills FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete rapt pills" ON public.rapt_pills FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Anyone can insert selected brews" ON public.selected_brews;
DROP POLICY IF EXISTS "Anyone can update selected brews" ON public.selected_brews;
DROP POLICY IF EXISTS "Anyone can delete selected brews" ON public.selected_brews;
CREATE POLICY "Authenticated can insert selected brews" ON public.selected_brews FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update selected brews" ON public.selected_brews FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete selected brews" ON public.selected_brews FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Anyone can insert selected pills" ON public.selected_rapt_pills;
DROP POLICY IF EXISTS "Anyone can update selected pills" ON public.selected_rapt_pills;
DROP POLICY IF EXISTS "Anyone can delete selected pills" ON public.selected_rapt_pills;
CREATE POLICY "Authenticated can insert selected pills" ON public.selected_rapt_pills FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update selected pills" ON public.selected_rapt_pills FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete selected pills" ON public.selected_rapt_pills FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Anyone can insert selected temp controllers" ON public.selected_rapt_temp_controllers;
DROP POLICY IF EXISTS "Anyone can update selected temp controllers" ON public.selected_rapt_temp_controllers;
DROP POLICY IF EXISTS "Anyone can delete selected temp controllers" ON public.selected_rapt_temp_controllers;
CREATE POLICY "Authenticated can insert selected temp controllers" ON public.selected_rapt_temp_controllers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update selected temp controllers" ON public.selected_rapt_temp_controllers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete selected temp controllers" ON public.selected_rapt_temp_controllers FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Anyone can update delta alerts" ON public.temp_delta_alerts;
DROP POLICY IF EXISTS "Anyone can delete delta alerts" ON public.temp_delta_alerts;
DROP POLICY IF EXISTS "Service role can insert delta alerts" ON public.temp_delta_alerts;
CREATE POLICY "Authenticated can update delta alerts" ON public.temp_delta_alerts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete delta alerts" ON public.temp_delta_alerts FOR DELETE TO authenticated USING (true);

-- 3. Remove publicly readable Spotify credentials (unused; real values live in backend secrets)
ALTER TABLE public.sonos_settings DROP COLUMN IF EXISTS spotify_client_id;
ALTER TABLE public.sonos_settings DROP COLUMN IF EXISTS spotify_client_secret;