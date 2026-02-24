import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Insert a notification into pending_notifications.
 * Deduplicates by type + brew_id/controller_id within the last hour.
 */
export async function insertNotification(
  supabase: ReturnType<typeof createClient>,
  opts: {
    type: string;
    title: string;
    body: string;
    brew_id?: string | null;
    controller_id?: string | null;
  }
): Promise<void> {
  // Deduplicate: skip if same type+target within last hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  let query = supabase
    .from("pending_notifications")
    .select("id")
    .eq("type", opts.type)
    .gte("created_at", oneHourAgo)
    .limit(1);

  if (opts.brew_id) query = query.eq("brew_id", opts.brew_id);
  if (opts.controller_id) query = query.eq("controller_id", opts.controller_id);

  const { data: existing } = await query;
  if (existing && existing.length > 0) return;

  await supabase.from("pending_notifications").insert({
    type: opts.type,
    title: opts.title,
    body: opts.body,
    brew_id: opts.brew_id ?? null,
    controller_id: opts.controller_id ?? null,
  });

  console.log(`🔔 Notification: [${opts.type}] ${opts.title}`);
}
