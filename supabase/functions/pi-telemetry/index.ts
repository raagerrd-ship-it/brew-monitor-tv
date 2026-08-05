import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createBrewSnapshot } from "../_shared/brew-snapshots.ts";

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

  // Levererad on-tid är sanningen för inlärning; duty_pct är bara begärt.
  function deliveredDuty(d: any): number | null {
    if (d?.delivered_on_s != null && d?.pwm_period_s) {
      return Math.round((Number(d.delivered_on_s) / Number(d.pwm_period_s)) * 1000) / 10;
    }
    return d?.duty_mean ?? d?.duty_pct ?? null;
  }

  // Pi skickar korta 8-tecken-id:n; DB har fulla uuid:n.
  // Pi:n grindar med regulating: false när tanken är avstängd — då mäts bara
  // temperaturen, inget duty-, snapshot- eller inlärningsdata ska sparas.
  const isRegulating = (d: any) => d?.regulating !== false;

  async function writeBackToController(d: any) {
    if (d.actual_temp == null && d.pt100_temp == null) return null;

    // SSOT: actual_temp = current_temp = snittet av PT100 och pill.
    // Pi:n räknar snittet lokalt (det den reglerar mot) och skickar det som
    // actual_temp, plus råvärdena pt100_temp/pill_temp.
    const { data: ctrl } = await supabase
      .from("rapt_temp_controllers")
      .select("controller_id, pill_temp")
      .like("controller_id", `${controller_id}%`)
      .eq("actuation", "pi")
      .maybeSingle();

    const probe = d.pt100_temp != null ? Number(d.pt100_temp) : Number(d.actual_temp);
    const pill = d.pill_temp != null
      ? Number(d.pill_temp)
      : (ctrl?.pill_temp != null ? Number(ctrl.pill_temp) : null);
    // Pi:n äger givarvalet (use_pt100 / use_pill lokalt) och skickar det fusionerade värdet.
    const fused = d.actual_temp != null ? Number(d.actual_temp) : probe;

    const patch: Record<string, any> = {
      actual_temp: fused,
      current_temp: fused,
      pt100_temp: probe,
      current_temp_updated_at: new Date().toISOString(),
      last_update: new Date().toISOString(),
      cooling_enabled: isRegulating(d) && d.mode === "cooling",
      heating_enabled: isRegulating(d) && d.mode === "heating",
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
    if (fullId && isRegulating(d) && deliveredDuty(d) != null) {
      const now = new Date().toISOString();
      await supabase.from("fermentation_learnings").upsert([
        {
          controller_id: fullId,
          parameter_name: "pid_last_duty",
          learned_value: Number(deliveredDuty(d) ?? d.duty_pct),
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
    return fullId ?? null;
  }

  // ── Profil-/metrics-state från Pi:ns profilmotor (Pi äger sanningen) ──
  async function writeProfileState(p: any) {
    if (!p || !p.session_id) return;
    if (p.shadow === true) return; // skuggkörning = inte verklig historik
    const patch: Record<string, any> = {
      status: p.status,
      current_step_index: p.current_step_index,
      updated_at: new Date().toISOString(),
    };
    if (p.step_started_at) patch.step_started_at = p.step_started_at;
    if (p.started_at) patch.started_at = p.started_at;
    if (p.step_start_temp !== undefined) patch.step_start_temp = p.step_start_temp;
    if (p.ramp_triggered_at !== undefined) patch.ramp_triggered_at = p.ramp_triggered_at;
    if (p.ramp_start_sg !== undefined) patch.ramp_start_sg = p.ramp_start_sg;
    if (p.step_label !== undefined) patch.step_label = p.step_label;
    if (p.progress !== undefined) patch.step_progress = p.progress;
    else if (p.step_progress !== undefined) patch.step_progress = p.step_progress;
    if (p.status === "completed" && !patch.completed_at) patch.completed_at = new Date().toISOString();

    const { error } = await supabase
      .from("fermentation_sessions")
      .update(patch)
      .eq("id", p.session_id);
    if (error) console.error("profile state write failed:", error.message);
  }

  async function writeMetrics(brewId: string | null | undefined, m: any) {
    if (!brewId || !m) return;
    const row: Record<string, any> = {
      brew_id: brewId,
      fermentation_phase: m.fermentation_phase ?? "unknown",
      activity_score: Number(m.activity_score ?? 0),
      sg_rate_per_hour: Number(m.sg_rate_per_hour ?? 0),
      eta_to_fg_hours: m.eta_to_fg_hours ?? null,
      peak_delta: Number(m.peak_delta ?? 0),
      peak_sg_rate_per_hour: Number(m.peak_sg_rate_per_hour ?? 0),
      ready_to_crash: Boolean(m.ready_to_crash),
      updated_at: new Date().toISOString(),
    };
    const { data: existing } = await supabase
      .from("brew_fermentation_metrics")
      .select("id")
      .eq("brew_id", brewId)
      .maybeSingle();
    const { error } = existing
      ? await supabase.from("brew_fermentation_metrics").update(row).eq("id", existing.id)
      : await supabase.from("brew_fermentation_metrics").insert(row);
    if (error) console.error("metrics write failed:", error.message);
  }

  // ── Pill-data via Pi:n (ersätter ingest-pill-ble för Pi-styrda tankar) ──
  async function writePillAndBrew(fullId: string, d: any) {
    const { data: ctrl } = await supabase
      .from("rapt_temp_controllers")
      .select("controller_id, linked_pill_id")
      .eq("controller_id", fullId)
      .maybeSingle();
    const pillId = ctrl?.linked_pill_id;
    if (!pillId) return;

    const recordedAt = d.recorded_at || new Date().toISOString();
    const pillUpdate: Record<string, any> = {
      last_update: recordedAt,
      updated_at: new Date().toISOString(),
    };
    if (d.pill_temp != null) pillUpdate.temperature = Number(Number(d.pill_temp).toFixed(3));
    if (d.pill_gravity_sg != null) pillUpdate.gravity = Number(Number(d.pill_gravity_sg).toFixed(5));
    if (d.pill_battery_pct != null) pillUpdate.battery_level = Math.round(Number(d.pill_battery_pct));
    await supabase.from("rapt_pills").update(pillUpdate).eq("pill_id", pillId);

    const { data: brew } = await supabase
      .from("brew_readings")
      .select("id, original_gravity, fermentation_start")
      .eq("linked_pill_id", pillId)
      .in("status", ["fermenting", "active", "Jäsning"])
      .maybeSingle();
    if (!brew) return;
    if (brew.fermentation_start && new Date(recordedAt) < new Date(brew.fermentation_start)) return;

    const sg = d.pill_gravity_sg != null ? Number(d.pill_gravity_sg) : null;
    const duty = deliveredDuty(d);
    // Grafdata: fönstermedel när Pi:n skickar dem, annars punktvärden.
    const m = d.means ?? {};

    // En rad per 3-minutersbucket — Pi-rollupen är SSOT för grafdatan.
    const bucketMs = 3 * 60 * 1000;
    const bucketedAt = new Date(
      Math.floor(new Date(recordedAt).getTime() / bucketMs) * bucketMs,
    ).toISOString();

    await createBrewSnapshot(supabase, brew.id, {
      recorded_at: bucketedAt,
      sg,
      pill_temp: m.pill ?? (d.pill_temp != null ? Number(d.pill_temp) : null),
      controller_temp: m.pt100 ?? (d.pt100_temp != null ? Number(d.pt100_temp) : null),
      profile_target_temp: d.target_temp ?? null,
      actual_temp: m.actual ?? d.actual_temp ?? null,
      duty_pct: duty,
      cooling_enabled: d.mode === "cooling",
      controller_id: fullId,
    });

    if (sg != null) {
      const og = Number(brew.original_gravity);
      const attenuation = og > 1
        ? Math.max(0, Math.min(100, Math.round(((og - sg) / (og - 1)) * 100)))
        : 0;
      const abv = og > 1 ? Math.max(0, Number(((og - sg) * 131.25).toFixed(1))) : 0;
      await supabase
        .from("brew_readings")
        .update({
          current_sg: sg,
          current_temp: d.actual_temp ?? null,
          attenuation,
          abv,
          battery: d.pill_battery_pct ?? null,
          last_update: recordedAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", brew.id);
    }
  }


  if (!controller_id || !kind) {
    return new Response(JSON.stringify({ error: "Missing controller_id or kind" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Piggyback response: return updated setpoint if version changed ──
  async function getSlimSetpointResponse() {
    const { data: sp } = await supabase
      .from("pi_setpoint")
      .select("controller_id, target_temp, params_version")
      .like("controller_id", `${controller_id}%`)
      .maybeSingle();
    if (!sp) return null;

    // volume_l från kopplad brygg-recept (mäsk + lakvatten) när det finns.
    let volume_l: number | null = null;
    const { data: ctrl } = await supabase
      .from("rapt_temp_controllers")
      .select("controller_id")
      .eq("controller_id", sp.controller_id)
      .maybeSingle();
    if (ctrl) {
      const { data: brew } = await supabase
        .from("brew_readings")
        .select("recipe")
        .eq("linked_controller_id", ctrl.controller_id)
        .in("status", ["fermenting", "active", "Jäsning"])
        .maybeSingle();
      const r: any = brew?.recipe;
      const mash = parseFloat(r?.mash_water_liters ?? "");
      const sparge = parseFloat(r?.sparge_water_liters ?? "");
      const sum = (Number.isFinite(mash) ? mash : 0) + (Number.isFinite(sparge) ? sparge : 0);
      if (sum > 0) volume_l = sum;
    }

    return {
      controller_id: String(sp.controller_id).slice(0, 8),
      target_temp: parseFloat(String(sp.target_temp)),
      volume_l,
      setpoint_version: sp.params_version,
    };
  }

  async function getSetpointResponse(setpointVersion?: number) {
    const { data: sp } = await supabase
      // OBS: learned_params och pill_temp får ALDRIG ingå i svaret till Pi:n.
      // Inlärning och mätvärden går bara uppåt; återställning görs manuellt.
      .from("pi_setpoint")
      .select("*")
      .like("controller_id", `${controller_id}%`)
      .maybeSingle();

    if (!sp) return null;

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
    };
  }

  /**
   * Arkiverar Pi:ns inlärda parametrar. Format:
   * { cooling: { process_gain: { value, samples, updated_at }, ... }, heating: {...} }
   * Tomt objekt lämnar arkivet orört. updated_at bevaras från nyttolasten.
   */
  async function archiveLearnedParams(fullId: string, learned: unknown) {
    if (!learned || typeof learned !== "object" || Array.isArray(learned)) return;
    const rows: Array<Record<string, unknown>> = [];
    for (const [mode, params] of Object.entries(learned as Record<string, any>)) {
      if (!params || typeof params !== "object") continue;
      for (const [name, entry] of Object.entries(params as Record<string, any>)) {
        const value = Number(entry?.value);
        const updatedAt = Number(entry?.updated_at);
        if (!Number.isFinite(value) || !Number.isFinite(updatedAt)) continue;
        rows.push({
          controller_id: fullId,
          mode,
          parameter_name: name,
          value,
          samples: Number(entry?.samples ?? 0),
          param_updated_at: updatedAt,
          received_at: new Date().toISOString(),
        });
      }
    }
    if (!rows.length) return;

    const { error } = await supabase
      .from("pi_learned_params")
      .upsert(rows, { onConflict: "controller_id,mode,parameter_name" });
    if (error) {
      console.error("Learned params upsert failed:", error);
      return;
    }

    // Historik: bara nya tidsstämplar.
    const { data: existing } = await supabase
      .from("pi_learned_params_history")
      .select("mode, parameter_name, param_updated_at")
      .eq("controller_id", fullId)
      .order("created_at", { ascending: false })
      .limit(200);
    const seen = new Set(
      (existing || []).map((r: any) => `${r.mode}|${r.parameter_name}|${r.param_updated_at}`)
    );
    const newRows = rows
      .filter((r) => !seen.has(`${r.mode}|${r.parameter_name}|${r.param_updated_at}`))
      .map(({ received_at, ...rest }) => rest);
    if (newRows.length) {
      await supabase.from("pi_learned_params_history").insert(newRows);
    }
  }

  if (kind === "live") {
    // ── Snabbsynk: UPSERT singleton row ──
    if (!data) {
      return new Response(JSON.stringify({ error: "Missing data" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: previous } = await supabase
      .from("pi_live_state")
      .select("cooling_relay_on, heating_relay_on, pump_started_at, pump_stopped_at")
      .eq("controller_id", controller_id)
      .maybeSingle();

    const wasRunning = previous
      ? Boolean(previous.cooling_relay_on || previous.heating_relay_on)
      : null;
    const isRunning = Boolean(data.cooling_relay_on || data.heating_relay_on);
    const transitionAt = new Date().toISOString();
    // Pi:n rapporterar helst intervallet (pwm_start/pwm_stop) — då slipper vi
    // aliasing från att sampla reläet.
    const pumpStartedAt = data.pwm_start
      ?? (wasRunning === false && isRunning ? transitionAt : previous?.pump_started_at ?? null);
    const pumpStoppedAt = data.pwm_stop
      ?? (wasRunning === true && !isRunning ? transitionAt : previous?.pump_stopped_at ?? null);

    const { error } = await supabase
      .from("pi_live_state")
      .upsert({
        controller_id,
        actual_temp: data.actual_temp ?? null,
        target_temp: data.target_temp ?? null,
        mode: data.mode ?? null,
        duty_pct: isRegulating(data) ? (data.duty_pct ?? 0) : 0,
        cooling_relay_on: data.cooling_relay_on ?? false,
        heating_relay_on: data.heating_relay_on ?? false,
        glycol_temp: data.glycol_temp ?? null,
        pid_terms: data.pid_terms ?? null,
        constraints_hit: data.constraints_hit ?? null,
        // Hålls separat från constraints_hit: mjuka PID-villkor är normal drift,
        // blocked_by betyder att tanken inte regleras alls.
        blocked_by: data.blocked_by ?? null,
        sensor_source: data.sensor_source ?? null,
        enabled: data.enabled ?? null,
        mode_allowed: data.mode_allowed ?? null,
        pump_started_at: pumpStartedAt,
        pump_stopped_at: pumpStoppedAt,
        last_heartbeat: new Date().toISOString(),
      }, { onConflict: "controller_id" });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await writeBackToController(data);

    // 30 s-pollen är slimmad: bara det Pi:n behöver för att reglera vidare.
    const setpointResponse = await getSlimSetpointResponse();

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

    // Pi:n skickar means-blocket: alla tre sensorerna medelvärdesbildade över
    // samma 180 s-fönster. Grafer/historik ska använda dem; punktvärdena
    // beskriver bara enskilda PID-beslut.
    const means = data.means ?? {};

    // Rollups med regulating:false förorenar historiken (degraderat sensor-
    // underlag, ingen duty). Logga underlaget och hoppa över insert.
    if (!isRegulating(data)) {
      console.warn("SKIPPED_HISTORY regulating=false", JSON.stringify({
        controller_id,
        recorded_at: data.recorded_at ?? null,
        received_at: new Date().toISOString(),
        regulating: data.regulating,
        enabled: data.enabled ?? null,
        blocked_by: data.blocked_by ?? null,
        mode: data.mode ?? null,
        sensor_source: data.sensor_source ?? null,
        actual_temp: data.actual_temp ?? null,
        pt100_temp: data.pt100_temp ?? null,
        pill_temp: data.pill_temp ?? null,
        means,
        target_temp: data.target_temp ?? null,
        keys: Object.keys(data),
      }));
    } else {
      const { error: histError } = await supabase
        .from("temp_controller_history")
        .insert({
          controller_id,
          current_temp: means.actual ?? data.temp_mean ?? data.actual_temp ?? null,
          target_temp: data.target_temp ?? null,
          cooling_enabled: data.mode === "cooling",
          recorded_at: data.recorded_at || new Date().toISOString(),
          profile_target_temp: data.target_temp ?? null,
          duty_pct: deliveredDuty(data),
          actual_temp: means.actual ?? data.actual_temp ?? null,
          pid_mode: data.mode ?? "v6",
        });

      if (histError) {
        console.error("History insert failed:", histError);
      }
    }

    // Sensorer + PID-tillstånd tillbaka till controller-raden, och pill-datan
    // dit ingest-pill-ble tidigare skrev (rapt_pills + brew_data_snapshots).
    const fullId = await writeBackToController(data);
    if (fullId && isRegulating(data)) {
      await writePillAndBrew(fullId, data);
      // Pi:n äger profilmotorn — vi speglar bara dess state för TV:n.
      await writeProfileState(data.profile);
      await writeMetrics(data.profile?.brew_id ?? null, data.metrics);
      // Pi:n äger inlärningen nu — molnet är bara ARKIV. Tomt objekt får
      // aldrig skriva över en tidigare sparad kopia.
      await archiveLearnedParams(fullId, data.learned_params);
    }

    // Also update pi_live_state with the rollup data
    if (data.actual_temp != null) {
      await supabase
        .from("pi_live_state")
        .upsert({
          controller_id,
          actual_temp: data.actual_temp,
          target_temp: data.target_temp,
          mode: isRegulating(data) ? data.mode : "off",
          duty_pct: isRegulating(data) ? (deliveredDuty(data) ?? 0) : 0,
          enabled: data.enabled !== false,
          mode_allowed: data.mode_allowed ?? undefined,
          cooling_relay_on: isRegulating(data) ? (data.cooling_relay_on ?? false) : false,
          heating_relay_on: isRegulating(data) ? (data.heating_relay_on ?? false) : false,
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
        .from("rapt_temp_controllers")
        .update({
          current_temp: data.glycol_temp,
          actual_temp: data.glycol_temp,
          pt100_temp: data.glycol_temp,
          target_temp: data.target_temp ?? undefined,
          cooling_enabled: data.compressor_on ?? false,
          last_update: data.recorded_at || new Date().toISOString(),
          current_temp_updated_at: new Date().toISOString(),
        })
        .eq("controller_id", cooler.controller_id);

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
