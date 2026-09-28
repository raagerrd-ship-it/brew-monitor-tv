CREATE OR REPLACE FUNCTION public.replace_profile_steps(p_profile_id uuid, p_steps jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.fermentation_profile_steps WHERE profile_id = p_profile_id;
  INSERT INTO public.fermentation_profile_steps (
    profile_id, step_order, step_type, target_temp, duration_hours, ramp_type,
    gravity_stable_days, gravity_threshold, target_sg, sg_comparison, notes,
    attenuation_trigger, temp_increase, activity_trigger, min_ramp_hours, ramp_curve,
    stability_window_minutes, stability_max_deviation, updated_at
  )
  SELECT p_profile_id, s.step_order, s.step_type, s.target_temp, s.duration_hours, s.ramp_type,
    s.gravity_stable_days, s.gravity_threshold, s.target_sg, s.sg_comparison, s.notes,
    s.attenuation_trigger, s.temp_increase, s.activity_trigger, s.min_ramp_hours, s.ramp_curve,
    s.stability_window_minutes, s.stability_max_deviation, coalesce(s.updated_at, now())
  FROM jsonb_to_recordset(coalesce(p_steps, '[]'::jsonb)) AS s(
    step_order integer, step_type text, target_temp numeric, duration_hours integer, ramp_type text,
    gravity_stable_days integer, gravity_threshold numeric, target_sg numeric, sg_comparison text, notes text,
    attenuation_trigger numeric, temp_increase numeric, activity_trigger numeric, min_ramp_hours integer, ramp_curve text,
    stability_window_minutes integer, stability_max_deviation numeric, updated_at timestamptz
  );
END;
$$;

REVOKE ALL ON FUNCTION public.replace_profile_steps(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_profile_steps(uuid, jsonb) TO service_role;