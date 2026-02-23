
CREATE OR REPLACE FUNCTION public.get_temp_history_sampled(p_controller_id text, p_start_time timestamp with time zone, p_end_time timestamp with time zone, p_sample_interval_minutes integer DEFAULT 30)
 RETURNS TABLE(recorded_at timestamp with time zone, current_temp numeric, target_temp numeric, cooling_enabled boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    date_trunc('minute', th.recorded_at) - 
      (EXTRACT(MINUTE FROM th.recorded_at)::INTEGER % p_sample_interval_minutes) * INTERVAL '1 minute' AS recorded_at,
    AVG(th.current_temp)::NUMERIC AS current_temp,
    -- Use last value in bucket for target_temp (step function, not continuous)
    (ARRAY_AGG(th.target_temp ORDER BY th.recorded_at DESC))[1]::NUMERIC AS target_temp,
    BOOL_OR(th.cooling_enabled) AS cooling_enabled
  FROM temp_controller_history th
  WHERE th.controller_id = p_controller_id
    AND th.recorded_at >= p_start_time
    AND th.recorded_at <= p_end_time
  GROUP BY 1
  ORDER BY 1 ASC;
END;
$function$;
