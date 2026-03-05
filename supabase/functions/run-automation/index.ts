import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let reqBody: any = {};
  try { reqBody = await req.json(); } catch { /* no body */ }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const results: { step: string; status: string; duration_ms: number; error?: string; details?: any }[] = [];

  // Helper to call an edge function with timeout protection
  async function runStep(
    name: string,
    functionName: string,
    body: Record<string, unknown> = {},
    timeoutMs: number = 20000
  ) {
    const stepStart = Date.now();
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const duration_ms = Date.now() - stepStart;

      if (!response.ok) {
        const errorText = await response.text();
        results.push({ step: name, status: "error", duration_ms, error: `${response.status}: ${errorText}` });
        return null;
      }

      const data = await response.json();
      results.push({ step: name, status: "ok", duration_ms, details: data });
      return data;
    } catch (err) {
      const duration_ms = Date.now() - stepStart;
      const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
      results.push({
        step: name,
        status: isTimeout ? "timeout" : "error",
        duration_ms,
        error: isTimeout ? `Timeout after ${timeoutMs}ms` : String(err),
      });
      return null;
    }
  }

  // Check what needs to run
  const [{ data: runningSessions }, { data: coolingSettings }, { data: activeControllers }] = await Promise.all([
    supabase.from("fermentation_sessions").select("id, controller_id").eq("status", "running").limit(100),
    supabase.from("auto_cooling_settings").select("enabled, pill_compensation_enabled").limit(1),
    supabase.from("rapt_temp_controllers")
      .select("controller_id")
      .or("cooling_enabled.eq.true,heating_enabled.eq.true")
      .not("is_glycol_cooler", "eq", true)
      .limit(1),
  ]);

  const settings = coolingSettings?.[0];
  const hasPillComp = (settings as any)?.pill_compensation_enabled;
  const hasCooling = settings?.enabled;
  const hasActiveControllers = activeControllers && activeControllers.length > 0;

  // ============================================================
  // STEP 1+2: Fermentation Profiles + Metrics (PARALLEL)
  // Both are independent — profiles sets target temps,
  // metrics computes SG rates. Both needed before step 3.
  // ============================================================
  const parallelSteps: Promise<any>[] = [];

  if (runningSessions && runningSessions.length > 0) {
    console.log("Step 1: Running fermentation profiles...");
    parallelSteps.push(runStep("fermentation-profiles", "process-fermentation-profiles", {}, 15000));
  } else {
    results.push({ step: "fermentation-profiles", status: "skipped", duration_ms: 0 });
    parallelSteps.push(Promise.resolve(null));
  }

  console.log("Step 2: Computing fermentation metrics...");
  parallelSteps.push(runStep("fermentation-metrics", "compute-fermentation-metrics", {}, 15000));

  await Promise.all(parallelSteps);

  // ============================================================
  // STEP 3+4: PID/Glycol + Health Check (PARALLEL)
  // Health check is independent and can run alongside cooling.
  // ============================================================
  const step3and4: Promise<any>[] = [];

  let pidAndGlycolData: any = null;
  if ((hasPillComp || hasCooling) && hasActiveControllers) {
    console.log("Step 3: Running PID compensation + glycol cooler...");
    step3and4.push(runStep("pid-and-glycol", "auto-adjust-cooling", { rapt_access_token: reqBody?.rapt_access_token || null, brew_sg_data: reqBody?.brew_sg_data || null }, 20000));
  } else {
    results.push({ step: "pid-and-glycol", status: "skipped", duration_ms: 0, details: !hasActiveControllers ? "no active controllers" : "features disabled" });
    step3and4.push(Promise.resolve(null));
  }

  console.log("Step 4: Running system health check...");
  step3and4.push(runStep("system-health-check", "system-health-check", {}, 10000));

  const [pidResult, healthData] = await Promise.all(step3and4);
  pidAndGlycolData = pidResult;

  // ============================================================
  // STEP 3b: PWM Bursts (runs AFTER PID, uses sleep for timing)
  // Each burst: set on-target → sleep duty_seconds → set off-target
  // ============================================================
  const pwmBursts = pidAndGlycolData?.pwm_bursts as Array<{
    controller_id: string;
    controller_name: string;
    on_target: number;
    off_target: number;
    duty_seconds: number;
    duty_pct: number;
  }> | undefined;

  if (pwmBursts && pwmBursts.length > 0) {
    console.log(`Step 3b: Executing ${pwmBursts.length} PWM burst(s)...`);
    const burstStart = Date.now();
    
    for (const burst of pwmBursts) {
      try {
        console.log(`  PWM ${burst.controller_name}: ${burst.duty_pct}% → ${burst.duty_seconds}s burst (on=${burst.on_target}°C, off=${burst.off_target}°C)`);
        
        // 1. Set on-target (triggers cooling)
        const onResp = await fetch(`${supabaseUrl}/functions/v1/rapt-update-controller`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ controllerId: burst.controller_id, action: "setTargetTemperature", value: burst.on_target, source: "pwm" }),
          signal: AbortSignal.timeout(10000),
        });
        
        if (!onResp.ok) {
          const errText = await onResp.text();
          console.error(`  PWM ON failed for ${burst.controller_name}: ${onResp.status} ${errText}`);
          results.push({ step: `pwm-burst-${burst.controller_name}`, status: "error", duration_ms: Date.now() - burstStart, error: `ON failed: ${onResp.status}` });
          continue;
        }

        // Update DB to reflect on-target
        await supabase.from('rapt_temp_controllers')
          .update({ target_temp: burst.on_target, updated_at: new Date().toISOString() })
          .eq('controller_id', burst.controller_id);

        // 2. Sleep for duty_seconds
        console.log(`  PWM ${burst.controller_name}: sleeping ${burst.duty_seconds}s...`);
        await new Promise(resolve => setTimeout(resolve, burst.duty_seconds * 1000));

        // 3. Set off-target (stops cooling)
        const offResp = await fetch(`${supabaseUrl}/functions/v1/rapt-update-controller`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ controllerId: burst.controller_id, action: "setTargetTemperature", value: burst.off_target, source: "pwm" }),
          signal: AbortSignal.timeout(10000),
        });

        if (!offResp.ok) {
          const errText = await offResp.text();
          console.error(`  PWM OFF failed for ${burst.controller_name}: ${offResp.status} ${errText}`);
          results.push({ step: `pwm-burst-${burst.controller_name}`, status: "error", duration_ms: Date.now() - burstStart, error: `OFF failed: ${offResp.status}` });
          continue;
        }

        // Update DB to reflect off-target
        await supabase.from('rapt_temp_controllers')
          .update({ target_temp: burst.off_target, updated_at: new Date().toISOString() })
          .eq('controller_id', burst.controller_id);

        const burstDuration = Date.now() - burstStart;
        console.log(`  PWM ${burst.controller_name}: burst complete in ${burstDuration}ms`);
        results.push({ step: `pwm-burst-${burst.controller_name}`, status: "ok", duration_ms: burstDuration, details: { duty_pct: burst.duty_pct, duty_seconds: burst.duty_seconds } });
      } catch (err) {
        const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
        results.push({
          step: `pwm-burst-${burst.controller_name}`,
          status: isTimeout ? "timeout" : "error",
          duration_ms: Date.now() - burstStart,
          error: String(err),
        });
      }
    }
  }

  // Log health summary to pending_notifications if critical
  if (healthData?.overall_status === 'critical') {
    const issuesSummary = (healthData.issues as string[])?.slice(0, 3).join('; ') ?? 'Unknown issues';
    // Deduplicate: only send if no recent health-critical notification
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recentHealthNotifs } = await supabase
      .from("pending_notifications")
      .select("id")
      .eq("type", "system_health_critical")
      .gte("created_at", oneHourAgo)
      .limit(1);

    if (!recentHealthNotifs || recentHealthNotifs.length === 0) {
      await supabase.from("pending_notifications").insert({
        type: "system_health_critical",
        title: "Systemhälsa: Kritisk",
        body: issuesSummary,
      });
    }
  }

  const totalDuration = Date.now() - startTime;
  const failedSteps = results.filter(r => r.status === "error" || r.status === "timeout");
  console.log(`Automation complete in ${totalDuration}ms: ${results.map(r => `${r.step}=${r.status}`).join(", ")}`);

  // SAFETY: Alert on repeated automation failures
  if (failedSteps.length > 0) {
    try {
      // Check if this is a repeated failure (2+ failures in last hour)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: recentNotifs } = await supabase
        .from("pending_notifications")
        .select("id")
        .eq("type", "automation_failure")
        .gte("created_at", oneHourAgo)
        .limit(3);

      const recentFailCount = recentNotifs?.length ?? 0;

      // Always notify on first failure, then only if pattern continues
      if (recentFailCount < 3) {
        const failSummary = failedSteps.map(f => `${f.step}: ${f.error ?? f.status}`).join("; ");
        await supabase.from("pending_notifications").insert({
          type: "automation_failure",
          title: "Automationsfel",
          body: `${failedSteps.length} steg misslyckades: ${failSummary}. Total tid: ${totalDuration}ms.`,
        });
        console.log(`🚨 Automation failure notification sent (${recentFailCount + 1} in last hour)`);
      }
    } catch (notifError) {
      console.error("Failed to send automation failure notification:", notifError);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, total_duration_ms: totalDuration, steps: results }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
