import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SECRETS = [
  Deno.env.get("BREW_INGEST_SECRET"),
  Deno.env.get("BREW_INGEST_SECRET_2"),
].filter(Boolean);

const num = (v: unknown) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const bool = (v: unknown) => v === true;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const provided = req.headers.get("x-brew-secret");
  if (!provided || !SECRETS.includes(provided)) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => null);
  if (!body || typeof body.is_active !== "boolean") return json({ error: "is_active (boolean) krävs" }, 400);

  const externalUserId = str(body.external_user_id, 120) ?? "brew-master";
  const milestones = Array.isArray(body.milestones) ? body.milestones.slice(0, 100) : [];
  const remaining = num(body.remaining_seconds) ?? 0;
  const total = num(body.total_seconds) ?? 0;

  const row = {
    external_user_id: externalUserId,
    is_active: body.is_active,
    label: str(body.label),
    remaining_seconds: Math.max(0, Math.round(remaining)),
    total_seconds: Math.max(0, Math.round(total)),
    is_paused: bool(body.is_paused),
    paused_by_milestone: bool(body.paused_by_milestone),
    milestones,
    next_milestone: body.next_milestone && typeof body.next_milestone === "object" ? body.next_milestone : null,
    time_to_next_milestone: num(body.time_to_next_milestone),
    progress: total > 0 ? Math.min(100, Math.max(0, ((total - remaining) / total) * 100)) : 0,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    paused_at: str(body.paused_at, 60),
    next_config: body.next_config && typeof body.next_config === "object" ? body.next_config : null,
    wizard_step: str(body.wizard_step, 80),
    wizard_started_at: str(body.wizard_started_at, 60),
    recipe_name: str(body.recipe_name),
    beer_style: str(body.beer_style),
    timer_action: str(body.timer_action, 60),
    timer_target_temperature: num(body.timer_target_temperature),
    zero_since: str(body.zero_since, 60),
  };

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error } = await supabase.from("cached_external_timer").upsert(row, { onConflict: "external_user_id" });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
});
