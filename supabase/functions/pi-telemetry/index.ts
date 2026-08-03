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

  let body: any = {};
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

  const { kind, controller_id, data } = body;
  // Pi skickar korta 8-tecken-id:n; DB har fulla uuid:n.
  async function writeBackToController(d: any) {
    if (d.actual_temp == null && d.pt100_temp == null) return;

    // SSOT: actual_temp = current_temp = snittet av PT100 och pill.
    // Pi:n räknar snittet lokalt (det den reglerar mot) och skickar det som
    // actual_temp, plus råvärdena pt100_temp/pill_temp.
    const { data: ctrl } = await supabase
      .from("rapt_temp_controllers")
      .select("controller_id, pill_temp, dual_sensor_enabled")
      .like("controller_id", `${controller_id}%`)
      .eq("actuation", "pi")
      .maybeSingle();

    const probe = d.pt100_temp != null ? Number(d.pt100_temp) : Number(d.actual_temp);
    const pill = d.pill_temp != null
      ? Number(d.pill_temp)
      : (ctrl?.pill_temp != null ? Number(ctrl.pill_temp) : null);
    const fused = d.actual_temp != null
      ? Number(d.actual_temp)
      : (ctrl?.dual_sensor_enabled && pill != null ? (probe + pill) / 2 : probe);

    const patch: Record<string, any> = {
      actual_temp: fused,
      current_temp: fused,
      pt100_temp: probe,
      current_temp_updated_at: new Date().toISOString(),
      last_update: new Date().toISOString(),
      cooling_enabled: d.mode === "cooling",
      heating_enabled: d.mode === "heating",
      updated_at: new Date().toISOString(),
    };
    const { data: rows, error } = await supabase
      .from("rapt_temp_controllers")
      .update(patch)
      .like("controller_id", `${controller_id}%`)
      .eq("actuation", "pi")
      .select("controller_id");
    if (error) console.error("controller writeback failed:", error.message);

    // Snapshot-loggningen (brew_data_snapshots) läser duty/mode från
    // fermentation_learnings. RAPT-PID:n kör inte längre för Pi-tankar,
    // så Pi:n måste själv hålla dessa nycklar färska.
    const fullId = rows?.[0]?.controller_id;
    if (fullId && d.duty_pct != null) {
      const now = new Date().toISOString();
      await supabase.from("fermentation_learnings").upsert([
        {
          controller_id: fullId,
          parameter_name: "pid_last_duty",
          learned_value: Number(d.duty_pct),
          sample_count: 1,
          last_updated_at: now,
        },
        {
          controller_id: fullId,
          parameter_name: "pid_current_mode",
          learned_value: d.mode === "cooling" ? 2 : d.mode === "heating" ? 1 : 0,
          sample_count: 1,
          last_updated_at: now,
        },
      ], { onConflict: "controller_id,parameter_name" });
    }
  }


  if (!controller_id || !kind) {
    return new Response(JSON.stringify({ error: "Missing controller_id or kind" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Piggyback response: return updated setpoint if version changed ──
  async function getSetpointResponse(setpointVersion?: number) {
    const { data: sp } = await supabase
      .from("pi_setpoint")
      .select("*")
      .like("controller_id", `${controller_id}%`)
      .maybeSingle();

    if (!sp) return null;

    // Fetch learned params from fermentation_learnings
    const { data: learnings } = await supabase
      .from("fermentation_learnings")
      .select("parameter_name, learned_value")
      .eq("controller_id", sp.controller_id);

    const params: Record<string, any> = {};
    if (learnings) {
      for (const row of learnings) {
        params[row.parameter_name] = parseFloat(String(row.learned_value));
      }
    }

    return {
      setpoint: {
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
      learned_params: params,
    };
  }

  if (kind === "live") {
    // ── Snabbsynk: UPSERT singleton row ──
    if (!data) {
      return new Response(JSON.stringify({ error: "Missing data" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error } = await supabase
      .from("pi_live_state")
      .upsert({
        controller_id,
        actual_temp: data.actual_temp ?? null,
        target_temp: data.target_temp ?? null,
        mode: data.mode ?? null,
        duty_pct: data.duty_pct ?? 0,
        cooling_relay_on: data.cooling_relay_on ?? false,
        heating_relay_on: data.heating_relay_on ?? false,
        glycol_temp: data.glycol_temp ?? null,
        pid_terms: data.pid_terms ?? null,
        constraints_hit: data.constraints_hit ?? null,
        sensor_source: data.sensor_source ?? null,
        enabled: data.enabled ?? null,
        mode_allowed: data.mode_allowed ?? null,
        last_heartbeat: new Date().toISOString(),
      }, { onConflict: "controller_id" });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await writeBackToController(data);

    // Return updated setpoint so Pi can piggyback
    const setpointResponse = await getSetpointResponse(data.setpoint_version);

    return new Response(JSON.stringify({ ok: true, setpoint: setpointResponse }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } else if (kind === "rollup") {
    // ── Full sync: write history row to temp_controller_history ──
    if (!data) {
      return new Response(JSON.stringify({ error: "Missing data" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: histError } = await supabase
      .from("temp_controller_history")
      .insert({
        controller_id,
        current_temp: data.temp_mean ?? data.actual_temp ?? null,
        target_temp: data.target_temp ?? null,
        cooling_enabled: data.mode === "cooling",
        recorded_at: data.recorded_at || new Date().toISOString(),
        profile_target_temp: data.target_temp ?? null,
        duty_pct: data.duty_mean ?? null,
        actual_temp: data.actual_temp ?? null,
        pid_mode: data.mode ?? "v6",
      });

    if (histError) {
      console.error("History insert failed:", histError);
    }

    // Also update pi_live_state with the rollup data
    if (data.actual_temp != null) {
      await supabase
        .from("pi_live_state")
        .upsert({
          controller_id,
          actual_temp: data.actual_temp,
          target_temp: data.target_temp,
          mode: data.mode,
          duty_pct: data.duty_mean ?? 0,
          glycol_temp: data.glycol_temp ?? null,
          last_heartbeat: new Date().toISOString(),
        }, { onConflict: "controller_id" });
    }

    const setpointResponse = await getSetpointResponse(data.setpoint_version);

    return new Response(JSON.stringify({ ok: true, setpoint: setpointResponse }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } else if (kind === "glycol") {
    // ── Glycol cooler telemetry ──
    // Write to temp_controller_history for the cooler controller_id
    if (!data) {
      return new Response(JSON.stringify({ error: "Missing data" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find the glycol cooler controller_id
    const { data: cooler } = await supabase
      .from("rapt_temp_controllers")
      .select("controller_id")
      .eq("is_glycol_cooler", true)
      .limit(1)
      .maybeSingle();

    if (cooler?.controller_id) {
      await supabase
        .from("temp_controller_history")
        .insert({
          controller_id: cooler.controller_id,
          current_temp: data.glycol_temp,
          target_temp: data.target_temp ?? null,
          cooling_enabled: data.compressor_on ?? false,
          recorded_at: data.recorded_at || new Date().toISOString(),
          actual_temp: data.glycol_temp,
          duty_pct: data.compressor_on ? 100 : 0,
          pid_mode: "v6",
        });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: `Unknown kind: ${kind}` }), {
    status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
