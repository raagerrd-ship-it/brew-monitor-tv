-- Add profile_target_temp to temp_controller_history
-- This stores the fermentation profile's base target (not the PID-adjusted one)
ALTER TABLE public.temp_controller_history 
ADD COLUMN profile_target_temp numeric NULL;

-- Update the sampling function to return profile_target_temp
CREATE OR REPLACE FUNCTION public.get_temp_history_sampled(
  p_controller_id text,
  p_start_time text,
  p_end_time text,
  p_sample_interval_minutes integer DEFAULT 15
)
RETURNS TABLE (
  recorded_at timestamp with time zone,
  current_temp numeric,
  target_temp numeric,
  cooling_enabled boolean,
  profile_target_temp numeric
)
LANGUAGE sql
STABLE
AS $$
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
    ROUND(AVG(current_temp), 2) AS current_temp,
    -- Use the last value in each bucket for target_temp (step function, not continuous)
    (ARRAY_AGG(target_temp ORDER BY recorded_at DESC))[1]::NUMERIC AS target_temp,
    BOOL_OR(cooling_enabled) AS cooling_enabled,
    -- Use the last value in each bucket for profile_target_temp
    (ARRAY_AGG(profile_target_temp ORDER BY recorded_at DESC))[1]::NUMERIC AS profile_target_temp
  FROM bucketed
  GROUP BY bucket
  ORDER BY bucket;
$$;