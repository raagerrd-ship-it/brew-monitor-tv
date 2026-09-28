import { createClient } from "npm:@supabase/supabase-js@2";

export const AUTH_HEADERS = "x-device-key, x-cron-secret";

function safeEqual(a: string | null, b: string | undefined): boolean {
  if (!a || !b) return false;
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export const isDevice = (req: Request) => safeEqual(req.headers.get("x-device-key"), Deno.env.get("DEVICE_KEY"));
export const isCron = (req: Request) => safeEqual(req.headers.get("x-cron-secret"), Deno.env.get("CRON_SECRET"));

export async function isUser(req: Request): Promise<boolean> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  // Anon key is a JWT too, but getUser rejects it (no user)
  const { data, error } = await supabase.auth.getUser(token);
  return !error && !!data.user;
}

export function unauthorized(corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
