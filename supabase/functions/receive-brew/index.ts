import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { normalizeYeasts } from "../_shared/yeast.ts";

const SECRETS = [
  Deno.env.get("BREW_INGEST_SECRET"),
  Deno.env.get("BREW_INGEST_SECRET_2"),
].filter(Boolean);

// Statusar där en omsändning aldrig får nollställa bryggen.
const DONE_STATUSES = ["Klar", "Completed", "Konditionering", "Conditioning", "Arkiverad"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const provided = req.headers.get("x-brew-secret");
  if (!provided || !SECRETS.includes(provided)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return json({ error: "name krävs" }, 400);
  }

  // Jäsprofil: platt id ur Pi:ns bibliotek eller en mallförfrågan.
  const profileId =
    typeof body.profile_id === "string" && body.profile_id.trim() ? body.profile_id : null;
  const profileRequest =
    body.profile_request && typeof body.profile_request === "object" && !Array.isArray(body.profile_request)
      ? body.profile_request
      : null;
  const hasProfile = profileId !== null || profileRequest !== null;

  // Utfallet matchas på source_id — utan den går profilen inte att följa upp.
  if (hasProfile && (body.source_id == null || String(body.source_id).trim() === "")) {
    return json({ error: "source_id krävs med jäsprofil" }, 400);
  }

  const num = (v: unknown) =>
    v == null || v === "" || isNaN(Number(v)) ? null : Number(v);

  // Fallbacks: avsändaren kan lägga värdena nästlade under targets/measurements.
  const t = body.targets ?? {};
  const m = body.measurements ?? {};
  const og = num(body.og) ?? num(m.og);
  const fg = num(body.fg) ?? num(m.fg);

  // Jästinfo normaliseras om den skickas; kravet ligger i avsändarappen.
  const yeasts = normalizeYeasts(body.yeasts);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // source_id = bryggd-id i Brew Master Dashboard. Gör anropet idempotent.
  const batchId = `custom_${String(body.source_id ?? crypto.randomUUID())}`;

  const { data: existing, error: existingError } = await supabase
    .from("brew_readings")
    .select("id, pi_pending_at, linked_controller_id, status, recipe")
    .eq("batch_id", batchId)
    .maybeSingle();

  if (existingError) return json({ error: "Databasfel" }, 500);

  // Behåll lagrad jäst när omsändningen saknar (eller har tom) jästlista —
  // annars skulle jäst tillagd i TV-appen raderas.
  const storedRecipe =
    existing?.recipe && typeof existing.recipe === "object" && !Array.isArray(existing.recipe)
      ? (existing.recipe as Record<string, unknown>)
      : {};
  const mergedYeasts = yeasts.length > 0
    ? yeasts
    : (Array.isArray(storedRecipe.yeasts) ? storedRecipe.yeasts : yeasts);

  // Spara hela nyttolasten så inget avsändaren skickar går förlorat.
  // yeasts lyfts ut på toppnivå eftersom pi-control läser spannet därifrån.
  const recipe = { ...storedRecipe, ...body, yeasts: mergedYeasts };

  // Profilfrågan stämplas i varje gren så den når Pi:n även efter tankval.
  const profileAsk = hasProfile ? { profile_ask_at: new Date().toISOString() } : {};

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
    recipe,
    // Lägger satsen direkt i kön till Jäscontrollern.
    pi_pending_at: new Date().toISOString(),
    ...profileAsk,
  };

  // Full omskrivning bara för nya bryggor eller bryggor som fortfarande står i
  // kön (ej i tank, inte klara). Allt annat — i tank, tappad, klar — får bara
  // recept, namn, stil och volym uppdaterade; status, gravities, pitchtid och
  // köstämpel rörs aldrig.
  const stillQueued =
    !!existing &&
    existing.pi_pending_at != null &&
    !existing.linked_controller_id &&
    !DONE_STATUSES.includes(existing.status);

  if (existing && !stillQueued) {
    const { data: upd, error: updError } = await supabase
      .from("brew_readings")
      .update({
        recipe,
        name: row.name,
        style: row.style,
        ...(row.volume_l != null ? { volume_l: row.volume_l } : {}),
        ...profileAsk,
      })
      .eq("id", existing.id)
      .select("id, batch_id, name, style, volume_l, pi_pending_at")
      .single();
    if (updError) return json({ error: "Databasfel" }, 500);
    return json({ ok: true, brew: upd });
  }

  const { data, error } = await supabase
    .from("brew_readings")
    .upsert(row, { onConflict: "batch_id" })
    .select("id, batch_id, name, style, volume_l, pi_pending_at")
    .single();

  if (error) return json({ error: "Databasfel" }, 500);

  // Ingen ny notis vid omsändning.
  if (!existing) {
    await supabase.from("pending_notifications").insert({
      type: "brew_pending",
      title: "Ny brygg från Dashboard",
      body: `${data.name} väntar på tank i Jäscontrollern`,
      brew_id: data.id,
    });
  }

  return json({ ok: true, brew: data });
});
