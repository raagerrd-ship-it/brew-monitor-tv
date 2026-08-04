import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SECRET = Deno.env.get("PI_BLE_INGEST_SECRET")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // ── Auth ──
  const piSecret = req.headers.get("x-pi-secret");
  if (!piSecret || piSecret !== SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Controller_id from query param
  const url = new URL(req.url);
  const controllerId = url.searchParams.get("controller_id");

  // ── One-shot handover: running fermentation sessions + their profile steps ──
  if (url.searchParams.get("handover") === "sessions") {
    const { data: sessions } = await supabase
      .from("fermentation_sessions")
      .select("id, profile_id, brew_id, controller_id, status, current_step_index, step_started_at, step_start_temp, ramp_triggered_at, ramp_start_sg, started_at")
      .eq("status", "running");

    const profileIds = [...new Set((sessions || []).map((s: any) => s.profile_id))];
    const { data: steps } = profileIds.length
      ? await supabase
        .from("fermentation_profile_steps")
        .select("*")
        .in("profile_id", profileIds)
        .order("step_order", { ascending: true })
      : { data: [] };

    const { data: controllers } = await supabase
      .from("rapt_temp_controllers")
      .select("controller_id, name, profile_target_temp, min_target_temp, max_target_temp");

    const ctrlById = new Map((controllers || []).map((c: any) => [c.controller_id, c]));

    return new Response(JSON.stringify({
      generated_at: new Date().toISOString(),
      sessions: (sessions || []).map((s: any) => ({
        ...s,
        controller_short_id: String(s.controller_id).slice(0, 8),
        controller_name: ctrlById.get(s.controller_id)?.name ?? null,
        profile_target_temp: ctrlById.get(s.controller_id)?.profile_target_temp ?? null,
        min_target_temp: ctrlById.get(s.controller_id)?.min_target_temp ?? null,
        max_target_temp: ctrlById.get(s.controller_id)?.max_target_temp ?? null,
        steps: (steps || []).filter((st: any) => st.profile_id === s.profile_id),
      })),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (!controllerId) {
    // Return all setpoints for this Pi
    const { data: controllers } = await supabase
      .from("rapt_temp_controllers")
      .select("controller_id, name, actuation, pill_temp, dual_sensor_enabled, last_update")
      .eq("actuation", "pi");

    if (!controllers || controllers.length === 0) {
      return new Response(JSON.stringify({ setpoints: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ids = controllers.map((c: any) => c.controller_id);
    const ctrlById = new Map(controllers.map((c: any) => [c.controller_id, c]));
    const { data: setpoints } = await supabase
      .from("pi_setpoint")
      .select("*")
      .in("controller_id", ids);

    const result = (setpoints || []).map((sp: any) => ({
      // Pi config uses the 8-char short id; DB uses the full uuid.
      controller_id: String(sp.controller_id).slice(0, 8),
      pill_temp: ctrlById.get(sp.controller_id)?.pill_temp != null
        ? parseFloat(String(ctrlById.get(sp.controller_id)!.pill_temp)) : null,
      pill_updated_at: ctrlById.get(sp.controller_id)?.last_update ?? null,
      dual_sensor_enabled: ctrlById.get(sp.controller_id)?.dual_sensor_enabled !== false,
      target_temp: parseFloat(String(sp.target_temp)),
      mode_allowed: sp.mode_allowed,
      enabled: sp.enabled !== false,
      max_duty_pct: parseFloat(String(sp.max_duty_pct)),
      pwm_period_s: sp.pwm_period_s,
      min_on_s: sp.min_on_s,
      min_off_s: sp.min_off_s,
      set_at: sp.set_at,
      set_by: sp.set_by,
      params_version: sp.params_version,
    }));

    return new Response(JSON.stringify({ setpoints: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Single controller
  // Accept both short (8-char) and full uuid ids.
  const { data: sp } = await supabase
    .from("pi_setpoint")
    .select("*")
    .like("controller_id", `${controllerId}%`)
    .maybeSingle();

  if (!sp) {
    return new Response(JSON.stringify({ error: "No setpoint found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({
    setpoint: {
      controller_id: String(sp.controller_id).slice(0, 8),
      target_temp: parseFloat(String(sp.target_temp)),
      mode_allowed: sp.mode_allowed,
      enabled: sp.enabled !== false,
      max_duty_pct: parseFloat(String(sp.max_duty_pct)),
      pwm_period_s: sp.pwm_period_s,
      min_on_s: sp.min_on_s,
      min_off_s: sp.min_off_s,
      set_at: sp.set_at,
      set_by: sp.set_by,
      params_version: sp.params_version,
    },
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
