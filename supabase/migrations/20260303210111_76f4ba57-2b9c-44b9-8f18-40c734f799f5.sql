DROP FUNCTION IF EXISTS public.get_temp_history_sampled(text, text, text, integer);

CREATE OR REPLACE FUNCTION public.get_temp_history_sampled(p_controller_id text, p_start_time text, p_end_time text, p_sample_interval_minutes integer DEFAULT 15)
 RETURNS TABLE(recorded_at timestamp with time zone, current_temp numeric, target_temp numeric, cooling_enabled boolean, profile_target_temp numeric, cooling_ratio numeric)
 LANGUAGE sql
 STABLE
AS $function$
  WITH bucketed AS (
    SELECT
      date_trunc('hour', th.recorded_at)
        + (EXTRACT(minute FROM th.recorded_at)::int / p_sample_interval_minutes)
          * (p_sample_interval_minutes || ' minutes')::interval AS bucket,
      th.current_temp,
      th.target_temp,
      th.cooling_enabled,
      th.profile_target_temp,
      th.recorded_at
    FROM public.temp_controller_history th
    WHERE th.controller_id = p_controller_id
      AND th.recorded_at >= p_start_time::timestamptz
      AND th.recorded_at <= p_end_time::timestamptz
  )
  SELECT
    bucket AS recorded_at,
    (ARRAY_AGG(current_temp ORDER BY recorded_at DESC))[1]::NUMERIC AS current_temp,
    (ARRAY_AGG(target_temp ORDER BY recorded_at DESC))[1]::NUMERIC AS target_temp,
    BOOL_OR(cooling_enabled) AS cooling_enabled,
    (ARRAY_AGG(profile_target_temp ORDER BY recorded_at DESC))[1]::NUMERIC AS profile_target_temp,
    COUNT(*) FILTER (WHERE cooling_enabled)::NUMERIC / NULLIF(COUNT(*), 0) AS cooling_ratio
  FROM bucketed
  GROUP BY bucket
  ORDER BY bucket;
$function$;