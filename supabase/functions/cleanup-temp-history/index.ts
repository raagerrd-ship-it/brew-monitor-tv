import { isDevice, isUser, isCron, unauthorized, AUTH_HEADERS } from "../_shared/auth.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, " + AUTH_HEADERS,
};

/**
 * Retention cleanup — runs daily via cron.
 * 7d:  temp_controller_history
 * 30d: fermentation_step_log (only completed sessions)
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }


  if (!(isCron(req) || await isUser(req))) return unauthorized(corsHeaders);
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Delete in batches to avoid timeouts on large tables
    let totalControllerDeleted = 0;

    // temp_controller_history: pruned hourly in SQL (prune_temp_controller_history)


    // fermentation_step_log (keep 30 days, only for completed sessions)
    let totalStepLogDeleted = 0;
    while (true) {
      const { data } = await supabase
        .from("fermentation_step_log")
        .select("id, session_id")
        .lt("created_at", cutoff30d)
        .limit(1000);
      if (!data || data.length === 0) break;
      // Get active session IDs to exclude
      const sessionIds = [...new Set(data.map((r: any) => r.session_id))];
      const { data: activeSessions } = await supabase
        .from("fermentation_sessions")
        .select("id")
        .in("id", sessionIds)
        .in("status", ["running", "paused"]);
      const activeIds = new Set((activeSessions || []).map((s: any) => s.id));
      const toDelete = data.filter((r: any) => !activeIds.has(r.session_id)).map((r: any) => r.id);
      if (toDelete.length === 0) break;
      await supabase.from("fermentation_step_log").delete().in("id", toDelete);
      totalStepLogDeleted += toDelete.length;
    }

    const msg = `Deleted: ${totalControllerDeleted} controller history (>7d), ${totalStepLogDeleted} step logs (>30d completed)`;
    console.log(`[CleanupTempHistory] ${msg}`);

    return new Response(
      JSON.stringify({
        success: true, message: msg,
        controllerDeleted: totalControllerDeleted, stepLogDeleted: totalStepLogDeleted,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[CleanupTempHistory] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
