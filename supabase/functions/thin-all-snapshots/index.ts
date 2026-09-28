import { isDevice, isUser, isCron, unauthorized, AUTH_HEADERS } from "../_shared/auth.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { thinSnapshots } from "../_shared/brew-snapshots.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, " + AUTH_HEADERS,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }


  if (!(isCron(req) || await isUser(req))) return unauthorized(corsHeaders);
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Thin per active brew (finished/archived brews get no new snapshots)
    const { data: brews } = await supabase
      .from("brew_readings")
      .select("id")
      .not("status", "in", "(Klar,Arkiverad)");
    const allBrewIds: string[] = (brews ?? []).map((b: { id: string }) => b.id);

    console.log(`[ThinAll] Found ${allBrewIds.length} brews with snapshots`);

    let totalThinned = 0;
    for (const brewId of allBrewIds) {
      await thinSnapshots(supabase, brewId);
      // Quick count to log (non-critical)
      totalThinned++;
    }

    const msg = `Thinned snapshots for ${totalThinned} brews`;
    console.log(`[ThinAll] ${msg}`);

    return new Response(JSON.stringify({ success: true, message: msg, brews: totalThinned }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[ThinAll] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
