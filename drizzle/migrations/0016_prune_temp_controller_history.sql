CREATE OR REPLACE FUNCTION public.prune_temp_controller_history()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n1 integer; n2 integer;
BEGIN
  DELETE FROM public.temp_controller_history WHERE recorded_at < now() - interval '7 days';
  GET DIAGNOSTICS n1 = ROW_COUNT;
  -- Older than 24h: keep one row per controller per 15-minute bucket
  DELETE FROM public.temp_controller_history t
  USING (
    SELECT id, row_number() OVER (
      PARTITION BY controller_id, date_bin('15 minutes', recorded_at, timestamptz '2000-01-01')
      ORDER BY recorded_at) rn
    FROM public.temp_controller_history
    WHERE recorded_at < now() - interval '24 hours'
  ) d
  WHERE t.id = d.id AND d.rn > 1;
  GET DIAGNOSTICS n2 = ROW_COUNT;
  RETURN n1 + n2;
END $$;
REVOKE ALL ON FUNCTION public.prune_temp_controller_history() FROM PUBLIC, anon, authenticated;