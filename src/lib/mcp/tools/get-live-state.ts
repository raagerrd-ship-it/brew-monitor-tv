import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_live_state",
  title: "Get Pi live state",
  description: "Read the Raspberry Pi's latest live regulation state per controller (mode, relays, duty, heartbeat).",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_args, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const { data, error } = await supabaseForUser(ctx)
      .from("pi_live_state")
      .select("controller_id, actual_temp, target_temp, mode, cooling_relay_on, heating_relay_on, duty_pct, glycol_temp, last_heartbeat");
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const states = (data ?? []).map((s) => ({
      controller_id: s.controller_id,
      actual_temp: s.actual_temp,
      target_temp: s.target_temp,
      mode: s.mode,
      cooling_relay_on: s.cooling_relay_on,
      heating_relay_on: s.heating_relay_on,
      duty_pct: s.duty_pct,
      glycol_temp: s.glycol_temp,
      last_heartbeat: s.last_heartbeat,
    }));
    return { content: [{ type: "text", text: JSON.stringify(states) }], structuredContent: { states } };
  },
});
