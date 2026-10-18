import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders as baseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";

const PI_SECRET = Deno.env.get("PI_BLE_INGEST_SECRET");
const BREW_SECRETS = [Deno.env.get("BREW_INGEST_SECRET"), Deno.env.get("BREW_INGEST_SECRET_2")].filter(Boolean);

// Brew Master hämtar biblioteket med x-brew-secret — den måste vara tillåten i CORS.
const corsHeaders = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-pi-secret, x-brew-secret",
};

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const secret = req.headers.get(req.method === "POST" ? "x-pi-secret" : "x-brew-secret");
  if (!secret || (req.method === "POST" ? secret !== PI_SECRET : !BREW_SECRETS.includes(secret))) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (req.method === "GET") {
    const { data, error } = await supabase.from("pi_profile_library")
      .select("payload, received_at").eq("id", 1).maybeSingle();
    if (error) return json({ error: "Library read failed" }, 500);
    return json(data ?? { payload: null, received_at: null });
  }

  // Limit actual UTF-8 bytes, including chunked requests without Content-Length.
  const reader = req.body?.getReader();
  if (!reader) return json({ error: "Invalid JSON" }, 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size >= 512 * 1024) {
      await reader.cancel();
      return json({ error: "Document must be under 512 KB" }, 400);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { return json({ error: "Invalid JSON" }, 400); }
  if (body?.contract !== 1) return json({ error: "contract must be 1" }, 400);
  if (!Array.isArray(body.profiles)) return json({ error: "profiles must be an array" }, 400);
  if (!body.builder || typeof body.builder !== "object" || Array.isArray(body.builder)) {
    return json({ error: "builder must be an object" }, 400);
  }
  if (typeof body.published_at !== "string" || !Number.isFinite(Date.parse(body.published_at))) {
    return json({ error: "published_at must be a timestamp" }, 400);
  }

  // Ett äldre dokument som skickas om sent får aldrig rulla biblioteket tillbaka.
  const { data: stored, error: readError } = await supabase.from("pi_profile_library")
    .select("published_at").eq("id", 1).maybeSingle();
  if (readError) return json({ error: "Library read failed" }, 500);
  if (stored && Date.parse(body.published_at) < Date.parse(stored.published_at)) {
    return json({ ok: true, ignored: "older" });
  }

  const { error } = await supabase.from("pi_profile_library").upsert({
    id: 1, payload: body, published_at: body.published_at, received_at: new Date().toISOString(),
  }, { onConflict: "id" });
  if (error) {
    // Postgres invalid-input (SQLSTATE-klass 22) är klientfel, inte serverfel.
    if (typeof error.code === "string" && error.code.startsWith("22")) {
      return json({ error: "Invalid input" }, 400);
    }
    return json({ error: "Library write failed" }, 500);
  }
  return json({ ok: true });
});
