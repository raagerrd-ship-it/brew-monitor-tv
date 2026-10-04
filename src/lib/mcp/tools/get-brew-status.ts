import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_brew_status",
  title: "Get brew status",
  description:
    "Read a brew's fermentation status from the Pi: measured OG and its source, fermentation start and its source, pitch details, expected FG. When og_source is 'pill' the OG was measured by the pill; when fermentation_start_source is 'pitch' the start time is when the brewer pitched the yeast — do not ask about it.",
  inputSchema: { source_id: z.string().describe("The brew's source_id") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (args, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const client = supabaseForUser(ctx);
    const { data: status, error } = await client
      .from("brew_status")
      .select("source_id, pi_brew_id, phase, og, og_source, og_measured, fg_expected, fermentation_start, fermentation_start_source, pitch, sg_current, attenuation_pct, updated_at")
      .eq("source_id", args.source_id)
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!status) return { content: [{ type: "text", text: "No status for that source_id" }], isError: true };

    const brewIds = [status.source_id, status.pi_brew_id].filter(Boolean) as string[];
    const { data: brew } = await client
      .from("brew_readings")
      .select("id, name, original_gravity, recipe")
      .in("id", brewIds)
      .limit(1)
      .maybeSingle();

    const result = {
      source_id: status.source_id,
      name: brew?.name ?? null,
      phase: status.phase,
      og: status.og,
      og_source: status.og_source,
      og_planned: (brew?.recipe as Record<string, unknown> | null)?.og ?? null,
      fg_expected: status.fg_expected,
      fermentation_start: status.fermentation_start,
      fermentation_start_source: status.fermentation_start_source,
      pitch: status.pitch,
      sg_current: status.sg_current,
      attenuation_pct: status.attenuation_pct,
      updated_at: status.updated_at,
    };
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
  },
});
