import { createClient } from "npm:@supabase/supabase-js@2";
import { thinSnapshots } from "../_shared/brew-snapshots.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get all distinct brew_ids from snapshots
    const allBrewIds: string[] = [];
    let offset = 0;
    const batchSize = 1000;
    let hasMore = true;
    while (hasMore) {
      const { data } = await supabase
        .from("brew_data_snapshots")
        .select("brew_id")
        .range(offset, offset + batchSize - 1);
      if (!data || data.length === 0) {
        hasMore = false;
      } else {
        for (const row of data) {
          if (!allBrewIds.includes(row.brew_id)) allBrewIds.push(row.brew_id);
        }
        offset += batchSize;
        hasMore = data.length === batchSize;
      }
    }

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
