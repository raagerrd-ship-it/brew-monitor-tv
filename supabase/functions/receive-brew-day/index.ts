import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SECRETS = [
  Deno.env.get("BREW_INGEST_SECRET"),
  Deno.env.get("BREW_INGEST_SECRET_2"),
].filter(Boolean);

const num = (v: unknown) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const provided = req.headers.get("x-brew-secret");
  if (!provided || !SECRETS.includes(provided)) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => null);
  if (!body || typeof body.active !== "boolean") return json({ error: "active (boolean) krävs" }, 400);

  const step = body.step ?? {};
  const items = Array.isArray(body.items)
    ? body.items.slice(0, 50).map((i: Record<string, unknown>, idx: number) => ({
        id: str(i?.id, 80) ?? String(idx),
        name: str(i?.name) ?? "—",
        amount: num(i?.amount),
        unit: str(i?.unit, 20),
        at_min: num(i?.at_min),
        checked: i?.checked === true,
      }))
    : [];

  const row = body.active
    ? {
        id: 1, active: true,
        recipe_name: str(body.recipe_name),
        step_id: str(step.id, 80), step_kind: str(step.kind, 40), step_title: str(step.title),
        target_temp_c: num(step.target_temp_c),
        items, updated_at: new Date().toISOString(),
      }
    : { id: 1, active: false, items: [], updated_at: new Date().toISOString() };

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error } = await supabase.from("brew_day_session").upsert(row, { onConflict: "id" });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
});
