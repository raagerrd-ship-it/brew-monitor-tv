import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_controllers",
  title: "List tank controllers",
  description: "List all fermentation tank controllers and the glycol cooler with current and target temperature.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_args, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const { data, error } = await supabaseForUser(ctx)
      .from("rapt_temp_controllers")
      .select("id, name, actual_temp, target_temp, is_glycol_cooler, cooling_enabled, heating_enabled, last_update")
      .order("name");
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const controllers = (data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      actual_temp: c.actual_temp,
      target_temp: c.target_temp,
      is_glycol_cooler: c.is_glycol_cooler,
      cooling_enabled: c.cooling_enabled,
      heating_enabled: c.heating_enabled,
      last_update: c.last_update,
    }));
    return { content: [{ type: "text", text: JSON.stringify(controllers) }], structuredContent: { controllers } };
  },
});
