-- Drop and recreate the function to accept TEXT instead of UUID
DROP FUNCTION IF EXISTS get_temp_history_sampled(UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER);

CREATE OR REPLACE FUNCTION get_temp_history_sampled(
  p_controller_id TEXT,
  p_start_time TIMESTAMPTZ,
  p_end_time TIMESTAMPTZ,
  p_sample_interval_minutes INTEGER DEFAULT 30
)
RETURNS TABLE(
  recorded_at TIMESTAMPTZ, 
  current_temp NUMERIC, 
  target_temp NUMERIC,
  cooling_enabled BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    date_trunc('minute', th.recorded_at) - 
      (EXTRACT(MINUTE FROM th.recorded_at)::INTEGER % p_sample_interval_minutes) * INTERVAL '1 minute' AS recorded_at,
    AVG(th.current_temp)::NUMERIC AS current_temp,
    AVG(th.target_temp)::NUMERIC AS target_temp,
    BOOL_OR(th.cooling_enabled) AS cooling_enabled
  FROM temp_controller_history th
  WHERE th.controller_id = p_controller_id
    AND th.recorded_at >= p_start_time
    AND th.recorded_at <= p_end_time
  GROUP BY 1
  ORDER BY 1 ASC;
END;
$$;