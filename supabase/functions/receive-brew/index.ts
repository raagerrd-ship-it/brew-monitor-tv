import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SECRET = Deno.env.get("BREW_INGEST_SECRET")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.headers.get("x-brew-secret") !== SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return json({ error: "name krävs" }, 400);
  }

  const num = (v: unknown) =>
    v == null || v === "" || isNaN(Number(v)) ? null : Number(v);

  // Fallbacks: avsändaren kan lägga värdena nästlade under targets/measurements.
  const t = body.targets ?? {};
  const m = body.measurements ?? {};
  const og = num(body.og) ?? num(m.og);
  const fg = num(body.fg) ?? num(m.fg);

  // Jästen: temperaturspannet är det enda som kan rädda en sats, så vi
  // lagrar hela listan i recipe-jsonen och låter pi-control plocka spannet.
  const yeasts = Array.isArray(body.yeasts) ? body.yeasts : null;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // source_id = bryggd-id i Brew Master Dashboard. Gör anropet idempotent.
  const batchId = `custom_${String(body.source_id ?? crypto.randomUUID())}`;

  const row = {
    batch_id: batchId,
    name: body.name.trim(),
    style: typeof body.style === "string" && body.style.trim() ? body.style.trim() : "Okänd",
    batch_number: String(body.batch_number ?? ""),
    status: "Fermenting",
    current_sg: og ?? 1,
    current_temp: 0,
    attenuation: 0,
    abv: 0,
    original_gravity: og ?? 1,
    final_gravity: fg ?? 1,
    // Avsändaren kan kalla volymen olika saker — ta första som finns.
    volume_l:
      num(body.volume_l) ??
      num(body.volume) ??
      num(body.volume_liters) ??
      num(body.batch_size) ??
      num(body.batch_size_l) ??
      num(t.batch_size_l) ??
      num(m.fermenter_volume_l),
    // Pitchtid sätts bara om den faktiskt inträffat — aldrig platshållare.
    fermentation_start: body.fermentation_start ?? null,
    recipe: yeasts ? { yeasts } : undefined,
    // Lägger satsen direkt i kön till Jäscontrollern.
    pi_pending_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("brew_readings")
    .upsert(row, { onConflict: "batch_id" })
    .select("id, batch_id, name, style, volume_l, pi_pending_at")
    .single();

  if (error) return json({ error: error.message }, 400);

  return json({ ok: true, brew: data });
});