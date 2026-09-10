import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SECRET = Deno.env.get("PI_BLE_INGEST_SECRET")!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Pi:n äger fälten. Saknas fältet = orört. null skrivs aldrig över ett känt värde.
const NUM = [
  "temp_current_c", "temp_target_c", "sg_current", "attenuation_pct",
  "og_measured", "fg_measured", "attenuation_final_pct", "fermentation_days",
  "time_in_band_pct", "temp_max_deviation_c",
  "volume_l", "abv_actual", "temp_max_c", "temp_min_c",
];
// Utfallsdata i slutrapporten — skrivs bara tillsammans med steps_executed.
const FINAL_JSON = ["time_in_band_pct_per_step", "sg_curve"];
const TEXT = ["phase", "fermenting_done_basis"];
const TIME = ["step_started_at", "step_ends_at", "fg_estimated_at", "fermenting_done_at"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (req.method === "GET") {
    const sourceId = new URL(req.url).searchParams.get("source_id");
    if (!sourceId) return json({ error: "source_id required" }, 400);
    const { data, error } = await supabase
      .from("brew_status").select("*").eq("source_id", sourceId).maybeSingle();
    if (error) return json({ error: error.message }, 500);
    return json({ status: data ?? null });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (req.headers.get("x-pi-secret") !== SECRET) return json({ error: "Unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const sourceId = body?.source_id;
  if (!sourceId) return json({ error: "source_id required" }, 400);

  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  const patch: Record<string, unknown> = {
    source_id: sourceId,
    updated_at: body.updated_at ?? new Date().toISOString(),
  };

  for (const k of NUM) if (has(k) && body[k] != null) patch[k] = Number(body[k]);
  for (const k of TEXT) if (has(k) && body[k] != null) patch[k] = String(body[k]);
  for (const k of TIME) if (has(k) && body[k] != null) patch[k] = body[k];
  // Tom lista är ett giltigt värde — friskt läge rensar gamla varningar.
  if (has("warnings") && Array.isArray(body.warnings)) patch.warnings = body.warnings;

  // Slutrapporten skrivs exakt en gång per bryggd.
  if (body.phase === "done" || has("steps_executed")) {
    const { data: existing } = await supabase
      .from("brew_status").select("final_report_at").eq("source_id", sourceId).maybeSingle();
    if (!existing?.final_report_at) {
      if (Array.isArray(body.steps_executed)) patch.steps_executed = body.steps_executed;
      for (const k of FINAL_JSON) if (has(k) && Array.isArray(body[k])) patch[k] = body[k];
      if (body.phase === "done") patch.final_report_at = patch.updated_at;
    } else {
      delete patch.steps_executed;
    }
  }

  const { error } = await supabase
    .from("brew_status").upsert(patch, { onConflict: "source_id" });
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true, source_id: sourceId });
});
