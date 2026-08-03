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

  if (!controllerId) {
    // Return all setpoints for this Pi
    const { data: controllers } = await supabase
      .from("rapt_temp_controllers")
      .select("controller_id, name, actuation")
      .eq("actuation", "pi");

    if (!controllers || controllers.length === 0) {
      return new Response(JSON.stringify({ setpoints: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ids = controllers.map((c: any) => c.controller_id);
    const { data: setpoints } = await supabase
      .from("pi_setpoint")
      .select("*")
      .in("controller_id", ids);

    // Fetch learned params for all Pi-controlled tanks
    const { data: learnings } = await supabase
      .from("fermentation_learnings")
      .select("controller_id, parameter_name, learned_value")
      .in("controller_id", ids);

    const paramsByController: Record<string, Record<string, number>> = {};
    if (learnings) {
      for (const row of learnings) {
        if (!paramsByController[row.controller_id]) paramsByController[row.controller_id] = {};
        paramsByController[row.controller_id][row.parameter_name] = parseFloat(String(row.learned_value));
      }
    }

    const result = (setpoints || []).map((sp: any) => ({
      controller_id: sp.controller_id,
      target_temp: parseFloat(String(sp.target_temp)),
      mode_allowed: sp.mode_allowed,
      max_duty_pct: parseFloat(String(sp.max_duty_pct)),
      pwm_period_s: sp.pwm_period_s,
      min_on_s: sp.min_on_s,
      min_off_s: sp.min_off_s,
      set_at: sp.set_at,
      set_by: sp.set_by,
      params_version: sp.params_version,
      learned_params: paramsByController[sp.controller_id] || {},
    }));

    return new Response(JSON.stringify({ setpoints: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Single controller
  const { data: sp } = await supabase
    .from("pi_setpoint")
    .select("*")
    .eq("controller_id", controllerId)
    .maybeSingle();

  if (!sp) {
    return new Response(JSON.stringify({ error: "No setpoint found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: learnings } = await supabase
    .from("fermentation_learnings")
    .select("parameter_name, learned_value")
    .eq("controller_id", controllerId);

  const learned_params: Record<string, number> = {};
  if (learnings) {
    for (const row of learnings) {
      learned_params[row.parameter_name] = parseFloat(String(row.learned_value));
    }
  }

  return new Response(JSON.stringify({
    setpoint: {
      controller_id: sp.controller_id,
      target_temp: parseFloat(String(sp.target_temp)),
      mode_allowed: sp.mode_allowed,
      max_duty_pct: parseFloat(String(sp.max_duty_pct)),
      pwm_period_s: sp.pwm_period_s,
      min_on_s: sp.min_on_s,
      min_off_s: sp.min_off_s,
      set_at: sp.set_at,
      set_by: sp.set_by,
      params_version: sp.params_version,
    },
    learned_params,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
