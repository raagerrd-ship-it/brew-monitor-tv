import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const PI_SECRET = Deno.env.get("PI_BLE_INGEST_SECRET");
// Pi:n skickar allt färdigräknat; bara kända fält skrivs.
const FIELDS = [
  "kind", "active", "level", "advice", "started_at", "ends_by", "ended_at", "bath_c", "bath_from_c",
  "stop_c", "rate_c_min", "eta_at", "compressor_on", "after_runs_done", "lift_pct", "result",
  "chiller_locked", "warnings", "sent_at", "chart",
];

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const secret = req.headers.get("x-pi-secret");
  if (!secret || secret !== PI_SECRET) return json({ error: "Unauthorized" }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "body must be an object" }, 400);
  if ("chart" in body && body.chart !== null && (typeof body.chart !== "object" || Array.isArray(body.chart))) {
    return json({ error: "chart must be an object or null" }, 400);
  }
  if ("warnings" in body && !(Array.isArray(body.warnings) && body.warnings.every((w: unknown) => typeof w === "string"))) {
    return json({ error: "warnings must be an array of strings" }, 400);
  }
  const row: Record<string, unknown> = { id: "glycol", updated_at: new Date().toISOString() };
  for (const f of FIELDS) if (f in body) row[f] = body[f];
  // Ej nullbara kolumner: null betyder standardvärdet.
  for (const [f, d] of [["active", false], ["compressor_on", false], ["chiller_locked", false], ["warnings", []]] as const) {
    if (f in row && row[f] === null) row[f] = d;
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error } = await supabase.from("chiller_session").upsert(row, { onConflict: "id" });
  if (error) {
    if (typeof error.code === "string" && error.code.startsWith("22")) return json({ error: "Invalid input" }, 400);
    return json({ error: "Write failed" }, 500);
  }
  return json({ ok: true });
});
