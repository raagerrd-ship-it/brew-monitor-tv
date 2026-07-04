import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { endpoint, subscription, device_info, action } = body ?? {};

    if (!endpoint || typeof endpoint !== "string" || endpoint.length > 2048) {
      return new Response(JSON.stringify({ error: "invalid endpoint" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (action === "unregister") {
      await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!subscription || typeof subscription !== "object") {
      return new Response(JSON.stringify({ error: "invalid subscription" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: existing } = await supabase
      .from("push_subscriptions")
      .select("id")
      .eq("endpoint", endpoint)
      .maybeSingle();

    if (existing) {
      await supabase.from("push_subscriptions")
        .update({ subscription, device_info: String(device_info ?? "").slice(0, 500), last_used_at: new Date().toISOString() })
        .eq("id", existing.id);
    } else {
      await supabase.from("push_subscriptions")
        .insert([{ endpoint, subscription, device_info: String(device_info ?? "").slice(0, 500) }]);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("register-push-subscription error", err);
    return new Response(JSON.stringify({ error: "internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});