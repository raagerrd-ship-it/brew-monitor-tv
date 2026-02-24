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
  // STEP 1: Fermentation Profiles (15s timeout)
  // ============================================================
  if (runningSessions && runningSessions.length > 0) {
    console.log("Step 1: Running fermentation profiles...");
    await runStep("fermentation-profiles", "process-fermentation-profiles", {}, 15000);
  } else {
    results.push({ step: "fermentation-profiles", status: "skipped", duration_ms: 0 });
  }

  // ============================================================
  // STEP 2: PID Pill Compensation + Glycol Cooler (20s timeout)
  // Both handled by auto-adjust-cooling in a single call
  // ============================================================
  if ((hasPillComp || hasCooling) && hasActiveControllers) {
    console.log("Step 2: Running PID compensation + glycol cooler...");
    await runStep("pid-and-glycol", "auto-adjust-cooling", {}, 20000);
  } else {
    results.push({ step: "pid-and-glycol", status: "skipped", duration_ms: 0, details: !hasActiveControllers ? "no active controllers" : "features disabled" });
  }

  // ============================================================
  // STEP 3: Fermentation Metrics (15s timeout)
  // Computes phase, activity score, ETA, cold crash readiness
  // ============================================================
  console.log("Step 3: Computing fermentation metrics...");
  await runStep("fermentation-metrics", "compute-fermentation-metrics", {}, 15000);

  const totalDuration = Date.now() - startTime;
  console.log(`Automation complete in ${totalDuration}ms: ${results.map(r => `${r.step}=${r.status}`).join(", ")}`);

  return new Response(
    JSON.stringify({ ok: true, total_duration_ms: totalDuration, steps: results }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
