import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

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
  const [{ data: runningSessions }, { data: coolingSettings }] = await Promise.all([
    supabase.from("fermentation_sessions").select("id, controller_id").eq("status", "running").limit(100),
    supabase.from("auto_cooling_settings").select("enabled, auto_boost_enabled, overshoot_prevention_enabled").limit(1),
  ]);

  const settings = coolingSettings?.[0];
  const hasStallOrOvershoot = settings?.auto_boost_enabled || settings?.overshoot_prevention_enabled;
  const hasCooling = settings?.enabled;

  // ============================================================
  // STEP 1: Fermentation Profiles (15s timeout, no AI)
  // ============================================================
  if (runningSessions && runningSessions.length > 0) {
    console.log("Step 1: Running fermentation profiles...");
    await runStep("fermentation-profiles", "process-fermentation-profiles", {}, 15000);
  } else {
    results.push({ step: "fermentation-profiles", status: "skipped", duration_ms: 0 });
  }

  // ============================================================
  // STEP 2: Tank adjustments - Stall & Overshoot (20s timeout)
  // Capture result to pass fresh data to step 3
  // ============================================================
  let tankResult: any = null;
  if (hasStallOrOvershoot) {
    console.log("Step 2: Running tank adjustments (stall/overshoot)...");
    tankResult = await runStep("tank-adjustments", "auto-adjust-cooling", { mode: "tank-adjustments" }, 20000);
  } else {
    results.push({ step: "tank-adjustments", status: "skipped", duration_ms: 0 });
  }

  // ============================================================
  // STEP 3: Glycol cooler - pass fresh adjustments from step 2
  // ============================================================
  if (hasCooling) {
    console.log("Step 3: Running glycol cooler regulation...");
    const glycolBody: Record<string, unknown> = { mode: "glycol-cooler" };
    if (tankResult?.adjustments && tankResult.adjustments.length > 0) {
      glycolBody.tankAdjustments = tankResult.adjustments;
    }
    await runStep("glycol-cooler", "auto-adjust-cooling", glycolBody, 20000);
  } else {
    results.push({ step: "glycol-cooler", status: "skipped", duration_ms: 0 });
  }

  const totalDuration = Date.now() - startTime;
  console.log(`Automation complete in ${totalDuration}ms: ${results.map(r => `${r.step}=${r.status}`).join(", ")}`);

  return new Response(
    JSON.stringify({ ok: true, total_duration_ms: totalDuration, steps: results }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
