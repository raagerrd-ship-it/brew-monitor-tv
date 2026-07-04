
-- 1. Fix mutable search_path on get_temp_history_sampled
CREATE OR REPLACE FUNCTION public.get_temp_history_sampled(p_controller_id text, p_start_time text, p_end_time text, p_sample_interval_minutes integer DEFAULT 15)
 RETURNS TABLE(recorded_at timestamp with time zone, current_temp numeric, target_temp numeric, cooling_enabled boolean, profile_target_temp numeric, cooling_ratio numeric, heating_ratio numeric, actual_temp numeric)
 LANGUAGE sql
 STABLE
 SET search_path = public
AS $function$
  WITH bucketed AS (
    SELECT
      date_trunc('hour', th.recorded_at)
        + (EXTRACT(minute FROM th.recorded_at)::int / p_sample_interval_minutes)
          * (p_sample_interval_minutes || ' minutes')::interval AS bucket,
      th.current_temp, th.target_temp, th.cooling_enabled,
      th.profile_target_temp, th.duty_pct, th.actual_temp, th.recorded_at
    FROM public.temp_controller_history th
    WHERE th.controller_id = p_controller_id
      AND th.recorded_at >= p_start_time::timestamptz
      AND th.recorded_at <= p_end_time::timestamptz
  )
  SELECT
    bucket, (ARRAY_AGG(current_temp ORDER BY recorded_at DESC))[1]::NUMERIC,
    (ARRAY_AGG(target_temp ORDER BY recorded_at DESC))[1]::NUMERIC,
    BOOL_OR(cooling_enabled),
    (ARRAY_AGG(profile_target_temp ORDER BY recorded_at DESC))[1]::NUMERIC,
    COALESCE(MAX(CASE WHEN cooling_enabled THEN duty_pct ELSE 0 END)/100.0, 0)::NUMERIC,
    COALESCE(MAX(CASE WHEN NOT cooling_enabled THEN duty_pct ELSE 0 END)/100.0, 0)::NUMERIC,
    (ARRAY_AGG(actual_temp ORDER BY recorded_at DESC))[1]::NUMERIC
  FROM bucketed GROUP BY bucket ORDER BY bucket;
$function$;

-- 2. Revoke EXECUTE on SECURITY DEFINER cron trigger functions from anon/authenticated
REVOKE EXECUTE ON FUNCTION public.trigger_custom_brew_sync() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_execute_pwm_off() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_rapt_quick_sync() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_sonos_now_playing_sync() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_auto_cooling_adjustment() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_external_timer_sync() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_ai_consultation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_rapt_sync_cron_schedule() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- 3. vapid_keys: service_role only
DROP POLICY IF EXISTS "Anyone can view vapid keys" ON public.vapid_keys;
DROP POLICY IF EXISTS "Service role can manage vapid keys" ON public.vapid_keys;
CREATE POLICY "vapid_keys_service_only" ON public.vapid_keys FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.vapid_keys FROM anon, authenticated;

-- 4. rapt_token_cache: service_role only
DROP POLICY IF EXISTS "Service role can manage rapt token cache" ON public.rapt_token_cache;
CREATE POLICY "rapt_token_cache_service_only" ON public.rapt_token_cache FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.rapt_token_cache FROM anon, authenticated;

-- 5. sonos_tokens: service_role only
DROP POLICY IF EXISTS "Service role can manage sonos tokens" ON public.sonos_tokens;
CREATE POLICY "sonos_tokens_service_only" ON public.sonos_tokens FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.sonos_tokens FROM anon, authenticated;

-- 6. push_subscriptions: service_role only (client goes through register-push-subscription edge function)
DROP POLICY IF EXISTS "Anyone can delete push subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Anyone can insert push subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Anyone can update push subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Anyone can view push subscriptions" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_service_only" ON public.push_subscriptions FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.push_subscriptions FROM anon, authenticated;

-- 7. profiles: only owner can update, only service_role can insert
DROP POLICY IF EXISTS "Service role can insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Service role can update profiles" ON public.profiles;
CREATE POLICY "profiles_service_insert" ON public.profiles FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- 8. Dashboard write tables: require authentication
DROP POLICY IF EXISTS "Anyone can insert auto cooling settings" ON public.auto_cooling_settings;
DROP POLICY IF EXISTS "Anyone can update auto cooling settings" ON public.auto_cooling_settings;
CREATE POLICY "auto_cooling_settings_auth_insert" ON public.auto_cooling_settings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auto_cooling_settings_auth_update" ON public.auto_cooling_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can insert plug commands" ON public.plug_commands;
DROP POLICY IF EXISTS "Anyone can update plug commands" ON public.plug_commands;
CREATE POLICY "plug_commands_auth_insert" ON public.plug_commands FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "plug_commands_auth_update" ON public.plug_commands FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can update plug state" ON public.plug_state;
CREATE POLICY "plug_state_auth_update" ON public.plug_state FOR UPDATE TO authenticated USING (id = 1) WITH CHECK (id = 1);

DROP POLICY IF EXISTS "Anyone can insert shared timer" ON public.shared_timer;
DROP POLICY IF EXISTS "Anyone can update shared timer" ON public.shared_timer;
CREATE POLICY "shared_timer_auth_insert" ON public.shared_timer FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "shared_timer_auth_update" ON public.shared_timer FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can insert sonos settings" ON public.sonos_settings;
DROP POLICY IF EXISTS "Anyone can update sonos settings" ON public.sonos_settings;
CREATE POLICY "sonos_settings_auth_insert" ON public.sonos_settings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "sonos_settings_auth_update" ON public.sonos_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can insert sync settings" ON public.sync_settings;
DROP POLICY IF EXISTS "Anyone can update sync settings" ON public.sync_settings;
CREATE POLICY "sync_settings_auth_insert" ON public.sync_settings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "sync_settings_auth_update" ON public.sync_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
