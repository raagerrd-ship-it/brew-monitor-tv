import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Deletes old rows from temp_controller_history (7 days),
 * temp_delta_history (7 days), auto_cooling_adjustments (30 days),
 * and cooler_margin_history (30 days).
 * Designed to run daily via cron.
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
        .lt("recorded_at", cutoff)
        .limit(1000);
      if (!data || data.length === 0) break;
      const ids = data.map((r: any) => r.id);
      await supabase.from("cooler_margin_history").delete().in("id", ids);
      totalMarginHistoryDeleted += ids.length;
    }

    const msg = `Deleted ${totalControllerDeleted} controller history + ${totalDeltaDeleted} delta history + ${totalAdjustmentsDeleted} adjustments + ${totalMarginHistoryDeleted} margin history older than 30 days`;
    console.log(`[CleanupTempHistory] ${msg}`);

    return new Response(
      JSON.stringify({ success: true, message: msg, controllerDeleted: totalControllerDeleted, deltaDeleted: totalDeltaDeleted, adjustmentsDeleted: totalAdjustmentsDeleted, marginHistoryDeleted: totalMarginHistoryDeleted }),
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
