import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ── SAFETY: Clean up dead PWM OFF rows (attempts ≥ 5) ──
  // These would permanently lock PID if left in the table.
  const { data: deadRows } = await supabase
    .from("pending_rapt_retries")
    .select("id, controller_id, target_temp, attempts, reason")
    .like("reason", "%PWM OFF%")
    .gte("attempts", 5);

  if (deadRows && deadRows.length > 0) {
    for (const dead of deadRows) {
      console.error(`🚨 SAFETY: PWM OFF stuck for ${dead.controller_id} after ${dead.attempts} attempts — cleaning up`);
      
      // Try one final time to revert hardware to safe target
      try {
        await fetch(`${supabaseUrl}/functions/v1/rapt-update-controller`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            controllerId: dead.controller_id,
            action: "setTargetTemperature",
            value: dead.target_temp,
            source: "pwm",
            pwm_label: `PWM OFF recovery: → ${dead.target_temp}°`,
          }),
          signal: AbortSignal.timeout(15000),
        });
      } catch (finalErr) {
        console.error(`🚨 Final recovery attempt failed for ${dead.controller_id}: ${finalErr}`);
      }

      // Delete the stuck row so PID can resume
      await supabase.from("pending_rapt_retries").delete().eq("id", dead.id);
      
      // Send critical notification
      await supabase.from("pending_notifications").insert({
        type: "pwm_stuck",
        title: "PWM-kommando fastnat",
        body: `PWM OFF för controller ${dead.controller_id} misslyckades ${dead.attempts} gånger. Raden har rensats och PID återupptas. Kontrollera att hårdvaran har rätt måltemperatur (${dead.target_temp}°C).`,
        controller_id: dead.controller_id,
      });
    }
  }

  // Find all scheduled PWM OFF commands that are due
  const { data: pendingOffs, error } = await supabase
    .from("pending_rapt_retries")
    .select("*")
    .like("reason", "%PWM OFF%")
    .not("execute_at", "is", null)
    .lte("execute_at", new Date().toISOString())
    .lt("attempts", 5);

  if (error || !pendingOffs || pendingOffs.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, processed: 0, deadCleaned: deadRows?.length ?? 0, reason: error ? error.message : "no pending" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log(`execute-pwm-off: ${pendingOffs.length} pending PWM OFF command(s) due`);

  const results: { controller_id: string; status: string; error?: string }[] = [];

  for (const retry of pendingOffs) {
    const burstStart = Date.now();
    let offOk = false;

    // Extract burst metadata from reason string
    // Reason format: "⚡ PWM OFF: hw → X° (Ys burst, Z% duty)"
    const dutyMatch = retry.reason.match(/(\d+)s burst/);
    const pctMatch = retry.reason.match(/(\d+)% duty/);
    const dutySecs = dutyMatch ? parseInt(dutyMatch[1]) : 0;
    const dutyPct = pctMatch ? parseInt(pctMatch[1]) : 0;
    const burstMode = retry.reason.toLowerCase().includes('heating') ? 'heating' : 'cooling';

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const offResp = await fetch(`${supabaseUrl}/functions/v1/rapt-update-controller`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            controllerId: retry.controller_id,
            action: "setTargetTemperature",
            value: retry.target_temp,
            source: "pwm",
            pwm_label: `PWM OFF: → ${retry.target_temp}°`,
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (offResp.ok) {
          offOk = true;
          break;
        }
        const errText = await offResp.text();
        console.error(`PWM OFF attempt ${attempt}/3 failed for ${retry.controller_id}: ${offResp.status}: ${errText}`);
      } catch (retryErr) {
        console.error(`PWM OFF attempt ${attempt}/3 error for ${retry.controller_id}: ${retryErr}`);
      }
      if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
    }

    const burstDuration = Date.now() - burstStart;

    if (offOk) {
      // Delete the pending retry
      await supabase.from("pending_rapt_retries").delete().eq("id", retry.id);

      // CRITICAL: Update DB target_temp to the revert value NOW that we've
      // confirmed the RAPT command succeeded. During the burst, DB was kept
      // at the burst value (0°C for cooling, maxTemp for heating) to match
      // the actual hardware state. Only now can we safely update.
      await supabase.from("rapt_temp_controllers")
        .update({ target_temp: retry.target_temp, updated_at: new Date().toISOString() })
        .eq("controller_id", retry.controller_id);

      // Create decision log for PWM OFF
      const shortName = (retry.controller_id as string).substring(0, 8);
      try {
        // Try to get controller name for nicer log
        const { data: ctrl } = await supabase
          .from("rapt_temp_controllers")
          .select("name")
          .eq("controller_id", retry.controller_id)
          .limit(1);
        const ctrlName = ctrl?.[0]?.name ?? retry.controller_id;
        const displayName = ctrlName.replace("Temp Controller ", "");

        await supabase.from("auto_cooling_decision_logs").insert({
          final_result: `⚡ PWM OFF: ${displayName} → ${retry.target_temp}° (${dutyPct}%)`,
          decisions: [
            {
              step: "PWM_OFF",
              result: "action",
              message: `${ctrlName}: burst ${dutySecs}s (${dutyPct}% duty) → revert to ${retry.target_temp}°C`,
              details: {
                controller_id: retry.controller_id,
                controller_name: ctrlName,
                duty_seconds: dutySecs,
                duty_pct: dutyPct,
                off_target: retry.target_temp,
                mode: burstMode,
              },
            },
            {
              step: "RAPT_SEND",
              result: "action",
              message: `✅ ${displayName}: mål → ${retry.target_temp}°C (PWM revert)`,
              details: {
                controller_id: retry.controller_id,
                target_temp: retry.target_temp,
                duration_ms: burstDuration,
              },
            },
          ],
          decision_count: 2,
          duration_ms: burstDuration,
          adjustment_made: true,
        });
      } catch (logErr) {
        console.error(`Failed to log PWM OFF decision: ${logErr}`);
      }

      console.log(`PWM OFF sent for ${retry.controller_id}: → ${retry.target_temp}°C`);
      results.push({ controller_id: retry.controller_id, status: "ok" });
    } else {
      // Increment attempts
      await supabase
        .from("pending_rapt_retries")
        .update({ attempts: (retry.attempts ?? 0) + 1 })
        .eq("id", retry.id);
      console.error(`PWM OFF failed for ${retry.controller_id} after 3 attempts`);
      results.push({ controller_id: retry.controller_id, status: "error", error: "All 3 attempts failed" });
    }
  }

  return new Response(
    JSON.stringify({ ok: true, processed: results.length, results }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
