ALTER TABLE public.brew_readings ADD COLUMN IF NOT EXISTS sg_history_at timestamptz;

CREATE OR REPLACE FUNCTION public.apply_pi_sg_history(p_brew_id uuid, p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE n integer;
BEGIN
  UPDATE public.brew_data_snapshots s
  SET sg = r.sg
  FROM (
    SELECT DISTINCT ON (bucket) bucket, sg FROM (
      SELECT to_timestamp(floor(extract(epoch FROM x.recorded_at) / 180) * 180) AS bucket, x.sg, x.recorded_at
      FROM jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) AS x(recorded_at timestamptz, sg numeric)
    ) b ORDER BY bucket, recorded_at DESC
  ) r
  WHERE s.brew_id = p_brew_id AND s.recorded_at = r.bucket;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    UPDATE public.brew_readings SET sg_history_at = now() WHERE id = p_brew_id;
  END IF;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.apply_pi_sg_history(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_pi_sg_history(uuid, jsonb) TO service_role;