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

  const results: { step: string; status: string; duration_ms: number; error?: string }[] = [];

  // Helper to call an edge function and wait for completion
  async function runStep(name: string, functionName: string) {
    const stepStart = Date.now();
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({}),
      });

      const duration_ms = Date.now() - stepStart;

      if (!response.ok) {
        const errorText = await response.text();
        results.push({ step: name, status: "error", duration_ms, error: `${response.status}: ${errorText}` });
        return false;
      }

      results.push({ step: name, status: "ok", duration_ms });
      return true;
    } catch (err) {
      const duration_ms = Date.now() - stepStart;
      results.push({ step: name, status: "error", duration_ms, error: String(err) });
      return false;
    }
  }

  // 1. Check if fermentation profiles need processing
  const { data: runningSessions } = await supabase
    .from("fermentation_sessions")
    .select("id")
    .eq("status", "running")
    .limit(1);

  if (runningSessions && runningSessions.length > 0) {
    await runStep("fermentation-profiles", "process-fermentation-profiles");
  } else {
    results.push({ step: "fermentation-profiles", status: "skipped", duration_ms: 0 });
  }

  // 2. Check if auto-cooling is enabled
  const { data: coolingSettings } = await supabase
    .from("auto_cooling_settings")
    .select("enabled")
    .eq("enabled", true)
    .limit(1);

  if (coolingSettings && coolingSettings.length > 0) {
    await runStep("auto-cooling", "auto-adjust-cooling");
  } else {
    results.push({ step: "auto-cooling", status: "skipped", duration_ms: 0 });
  }

  const totalDuration = Date.now() - startTime;

  return new Response(
    JSON.stringify({ ok: true, total_duration_ms: totalDuration, steps: results }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
