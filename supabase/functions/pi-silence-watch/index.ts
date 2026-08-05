import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { insertNotification } from "../_shared/notifications.ts";

// Tystnadslarm: molnet är den enda observatören som överlever att Pi:n dör.
// Larmar om ingen telemetri kommit in på SILENCE_MIN minuter.
const SILENCE_MIN = 10;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: rows, error } = await supabase
    .from("pi_live_state")
    .select("controller_id, last_heartbeat");

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const now = Date.now();
  const latest = (rows ?? []).reduce<number>((max, r) => {
    const t = r.last_heartbeat ? new Date(r.last_heartbeat).getTime() : 0;
    return t > max ? t : max;
  }, 0);

  const ageMin = latest ? Math.round((now - latest) / 60000) : null;
  const silent = ageMin === null || ageMin >= SILENCE_MIN;

  if (silent) {
    await insertNotification(supabase, {
      type: "pi_silence",
      title: "Pi:n har tystnat",
      body: ageMin === null
        ? "Ingen telemetri har någonsin tagits emot från Pi:n."
        : `Ingen telemetri på ${ageMin} minuter. Regulatorn kan ha kraschat eller maskinen vara nere.`,
    });
  }

  return new Response(JSON.stringify({ silent, age_minutes: ageMin }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
