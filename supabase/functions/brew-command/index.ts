import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SECRETS = [
  Deno.env.get("BREW_INGEST_SECRET"),
  Deno.env.get("BREW_INGEST_SECRET_2"),
].filter(Boolean);

const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

// Deterministisk uuid (v5-format, SHA-1) så att en omsändning blir samma rad.
async function stableUuid(key: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(key))).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const provided = req.headers.get("x-brew-secret");
  if (!provided || !SECRETS.includes(provided)) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "JSON-kropp krävs" }, 400);

  const command = str(body.command, 40);
  if (command !== "racked" && command !== "event") return json({ error: "Jästen kvitteras på Pi-panelen" }, 422);

  const srcId = str(body.id, 200);
  const sourceId = str(body.source_id, 64);
  if (!srcId || !sourceId || !/^[0-9a-f-]{36}$/i.test(sourceId)) return json({ error: "id och source_id (uuid) krävs" }, 400);

  const id = await stableUuid(`${command}:${srcId}`);
  const row = {
    id,
    source_id: sourceId,
    command,
    kind: str(body.kind, 60),
    racked_at: str(body.racked_at, 60),
    issued_at: str(body.issued_at, 60) ?? new Date().toISOString(),
    payload: command === "event" ? { ts: body.ts ?? null, data: body.data ?? null } : null,
  };

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error } = await supabase.from("pi_commands").upsert(row, { onConflict: "id", ignoreDuplicates: true });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, id });
});
