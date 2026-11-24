import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const PI_SECRET = Deno.env.get("PI_BLE_INGEST_SECRET");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Samma bucketing som bucketedAt i pi-telemetry/writePillAndBrew
const BUCKET_MS = 3 * 60 * 1000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!PI_SECRET || req.headers.get("x-pi-secret") !== PI_SECRET) return json({ error: "Unauthorized" }, 401);
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Ogiltig JSON" }, 400); }
  if (!body || typeof body !== "object" || typeof body.brew_id !== "string" || !UUID_RE.test(body.brew_id)) {
    return json({ error: "brew_id måste vara en uuid" }, 400);
  }
  if (!Array.isArray(body.rows)) return json({ error: "rows måste vara en lista" }, 400);
  if (body.rows.length > 1000) return json({ error: "Högst 1000 rader" }, 400);

  const rows: { recorded_at: string; sg: number }[] = [];
  const buckets = new Set<number>();
  for (const r of body.rows) {
    const t = typeof r?.recorded_at === "string" ? Date.parse(r.recorded_at) : NaN;
    if (!Number.isFinite(t)) return json({ error: "Ogiltig recorded_at" }, 400);
    if (typeof r.sg !== "number" || !Number.isFinite(r.sg) || r.sg < 0.95 || r.sg > 1.2) {
      return json({ error: "sg måste vara ett tal mellan 0.95 och 1.2" }, 400);
    }
    buckets.add(Math.floor(t / BUCKET_MS));
    rows.push({ recorded_at: new Date(t).toISOString(), sg: r.sg });
  }
  if (rows.length === 0) return json({ ok: true, updated: 0, unmatched: 0 });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await supabase.rpc("apply_pi_sg_history", { p_brew_id: body.brew_id, p_rows: rows });
  if (error) {
    console.error("[pi-sg-history]", error);
    return json({ error: "Databasfel" }, 500);
  }
  const updated = Number(data ?? 0);
  return json({ ok: true, updated, unmatched: Math.max(0, buckets.size - updated) });
});
