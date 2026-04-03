import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Retention cleanup — runs daily via cron.
 * 24h: auto_cooling_decision_logs
 * 7d:  temp_controller_history, temp_delta_history
 * 30d: auto_cooling_adjustments, cooler_margin_history,
 *      ai_audit_log, rapt_outage_log,
 *      fermentation_step_log (only completed sessions)
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Delete in batches to avoid timeouts on large tables
    let totalControllerDeleted = 0;
    let totalDeltaDeleted = 0;
    let totalAdjustmentsDeleted = 0;

    // temp_controller_history
    while (true) {
      const { data } = await supabase
        .from("temp_controller_history")
        .select("id")
        .lt("recorded_at", cutoff7d)
        .limit(1000);
      if (!data || data.length === 0) break;
      const ids = data.map((r: any) => r.id);
      await supabase.from("temp_controller_history").delete().in("id", ids);
      totalControllerDeleted += ids.length;
    }

    // temp_delta_history
    while (true) {
      const { data } = await supabase
        .from("temp_delta_history")
        .select("id")
        .lt("recorded_at", cutoff7d)
        .limit(1000);
      if (!data || data.length === 0) break;
      const ids = data.map((r: any) => r.id);
      await supabase.from("temp_delta_history").delete().in("id", ids);
      totalDeltaDeleted += ids.length;
    }

    // auto_cooling_adjustments
    while (true) {
      const { data } = await supabase
        .from("auto_cooling_adjustments")
        .select("id")
        .lt("created_at", cutoff30d)
        .limit(1000);
      if (!data || data.length === 0) break;
      const ids = data.map((r: any) => r.id);
      await supabase.from("auto_cooling_adjustments").delete().in("id", ids);
      totalAdjustmentsDeleted += ids.length;
    }

    // cooler_margin_history (keep 30 days)
    let totalMarginHistoryDeleted = 0;
    while (true) {
      const { data } = await supabase
        .from("cooler_margin_history")
        .select("id")
        .lt("recorded_at", cutoff30d)
        .limit(1000);
      if (!data || data.length === 0) break;
      const ids = data.map((r: any) => r.id);
      await supabase.from("cooler_margin_history").delete().in("id", ids);
      totalMarginHistoryDeleted += ids.length;
    }

    // auto_cooling_decision_logs (keep 24 hours)
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let totalDecisionLogsDeleted = 0;
    while (true) {
      const { data } = await supabase
        .from("auto_cooling_decision_logs")
        .select("id")
        .lt("created_at", cutoff24h)
        .limit(1000);
      if (!data || data.length === 0) break;
      const ids = data.map((r: any) => r.id);
      await supabase.from("auto_cooling_decision_logs").delete().in("id", ids);
      totalDecisionLogsDeleted += ids.length;
    }

    // ai_audit_log (keep 30 days)
    let totalAiAuditDeleted = 0;
    while (true) {
      const { data } = await supabase
        .from("ai_audit_log")
        .select("id")
        .lt("created_at", cutoff30d)
        .limit(1000);
      if (!data || data.length === 0) break;
      const ids = data.map((r: any) => r.id);
      await supabase.from("ai_audit_log").delete().in("id", ids);
      totalAiAuditDeleted += ids.length;
    }

    // rapt_outage_log (keep 30 days)
    let totalOutageDeleted = 0;
    while (true) {
      const { data } = await supabase
        .from("rapt_outage_log")
        .select("id")
        .lt("created_at", cutoff30d)
        .limit(1000);
      if (!data || data.length === 0) break;
      const ids = data.map((r: any) => r.id);
      await supabase.from("rapt_outage_log").delete().in("id", ids);
      totalOutageDeleted += ids.length;
    }

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

    const msg = `Deleted: ${totalControllerDeleted} controller history (>7d), ${totalDeltaDeleted} delta history (>7d), ${totalAdjustmentsDeleted} adjustments (>30d), ${totalMarginHistoryDeleted} margin history (>30d), ${totalDecisionLogsDeleted} decision logs (>24h), ${totalAiAuditDeleted} ai audit (>30d), ${totalOutageDeleted} outage logs (>30d), ${totalStepLogDeleted} step logs (>30d completed)`;
    console.log(`[CleanupTempHistory] ${msg}`);

    return new Response(
      JSON.stringify({
        success: true, message: msg,
        controllerDeleted: totalControllerDeleted, deltaDeleted: totalDeltaDeleted,
        adjustmentsDeleted: totalAdjustmentsDeleted, marginHistoryDeleted: totalMarginHistoryDeleted,
        decisionLogsDeleted: totalDecisionLogsDeleted, aiAuditDeleted: totalAiAuditDeleted,
        outageDeleted: totalOutageDeleted, stepLogDeleted: totalStepLogDeleted,
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
