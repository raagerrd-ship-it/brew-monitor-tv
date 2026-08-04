/**
 * Creates a single immutable data snapshot for a brew at sync time.
 * All values are pre-resolved by the caller — no historical lookup needed.
 * Once written, snapshots are never updated (ignoreDuplicates on unique constraint).
 */

export interface SnapshotData {
  recorded_at: string;
  sg: number | null;
  pill_temp: number | null;
  controller_temp: number | null;
  profile_target_temp: number | null;
  actual_temp?: number | null;
  // PWM duty (0–100) at snapshot time and whether the controller was in cooling mode.
  // If omitted but controller_id is provided, the most recent temp_controller_history
  // row (within the last 30 min) is used.
  duty_pct?: number | null;
  cooling_enabled?: boolean | null;
  controller_id?: string | null;
}

export async function createBrewSnapshot(
  supabase: any,
  brewId: string,
  data: SnapshotData
): Promise<boolean> {
  try {
    const { pill_temp, controller_temp } = data;
    // SSOT: use pre-calculated actual_temp from controller.
    // Fallback (pill → probe) matches single-sensor priority — never average without dual_sensor.
    const raw = data.actual_temp ?? pill_temp ?? controller_temp ?? null;
    const resolvedActualTemp = raw != null ? Math.round(raw * 100) / 100 : null;

    // Resolve PWM duty + cooling mode. SSOT: `fermentation_learnings.pid_last_duty`
    // is written by the PID on every cycle. Reading it here keeps the snapshot
    // DWT column in sync with the dashboard's PWM bar (same source, same age).
    // `temp_controller_history` only writes every 15 min, so falling back to it
    // would lag snapshots by up to 15 min and produce divergent numbers in UI.
    let duty = data.duty_pct ?? null;
    let cooling = data.cooling_enabled ?? null;
    if ((duty == null || cooling == null) && data.controller_id) {
      // pid_last_duty (fresh, per-cycle)
      if (duty == null) {
        const { data: dutyRow } = await supabase
          .from('fermentation_learnings')
          .select('learned_value, last_updated_at')
          .eq('controller_id', data.controller_id)
          .eq('parameter_name', 'pid_last_duty')
          .maybeSingle();
        if (dutyRow) {
          const ageMs = dutyRow.last_updated_at
            ? Date.now() - new Date(dutyRow.last_updated_at).getTime()
            : Infinity;
          // 15-min stale guard (matches UI bar in use-brew-data.ts)
          duty = ageMs > 15 * 60 * 1000 ? 0 : Number(dutyRow.learned_value);
        }
      }
      // Active PID mode (not hardware capability). `pid_current_mode` is written
      // by the PID every cycle: 1=heating, 2=cooling. Reading the controller's
      // `cooling_enabled` flag is wrong — it just says "cooling is allowed",
      // not which mode is actually running right now.
      if (cooling == null) {
        const { data: modeRow } = await supabase
          .from('fermentation_learnings')
          .select('learned_value, last_updated_at')
          .eq('controller_id', data.controller_id)
          .eq('parameter_name', 'pid_current_mode')
          .maybeSingle();
        if (modeRow) {
          const ageMs = modeRow.last_updated_at
            ? Date.now() - new Date(modeRow.last_updated_at).getTime()
            : Infinity;
          if (ageMs <= 15 * 60 * 1000) {
            cooling = Number(modeRow.learned_value) === 2;
          }
        }
      }
    }

    const { error } = await supabase
      .from('brew_data_snapshots')
      .upsert({
        brew_id: brewId,
        recorded_at: data.recorded_at,
        sg: data.sg,
        pill_temp: data.pill_temp,
        controller_temp: data.controller_temp,
        profile_target_temp: data.profile_target_temp,
        auto_target_temp: resolvedActualTemp,
        actual_temp: resolvedActualTemp,
        duty_pct: duty,
        cooling_enabled: cooling,
      }, { onConflict: 'brew_id,recorded_at', ignoreDuplicates: true });

    if (error) {
      console.error('Error inserting brew snapshot:', error);
      return false;
    }

    // Fire-and-forget: thin if oversized
    thinSnapshots(supabase, brewId).catch(() => {});
    return true;
  } catch (err) {
    console.error('Error in createBrewSnapshot:', err);
    return false;
  }
}


/**
 * Snapshot thinning — preserves recent detail, caps long-term resolution at 1/hour.
 *
 * Age bands:
 *   0–6h     → keep all (3-min resolution, untouched)
 *   6–48h    → 15-min resolution
 *   48–168h  → 30-min resolution
 *   168h+    → 60-min resolution
 *
 * No row-count ceiling. First & last rows are always kept.
 */
export async function thinSnapshots(supabase: any, brewId: string): Promise<void> {
  try {
    // Fetch all ids + timestamps sorted oldest-first (paginated)
    const allRows: { id: string; recorded_at: string }[] = [];
    let offset = 0;
    const batchSize = 1000;
    let hasMore = true;
    while (hasMore) {
      const { data } = await supabase
        .from('brew_data_snapshots')
        .select('id, recorded_at')
        .eq('brew_id', brewId)
        .order('recorded_at', { ascending: true })
        .range(offset, offset + batchSize - 1);
      if (!data || data.length === 0) { hasMore = false; }
      else {
        allRows.push(...data);
        offset += batchSize;
        hasMore = data.length === batchSize;
      }
    }

    if (allRows.length < 3) return;

    const now = Date.now();
    const MS_MIN = 60 * 1000;
    const MS_HOUR = 60 * MS_MIN;
    const cutoff6h   = now - 6   * MS_HOUR;
    const cutoff48h  = now - 48  * MS_HOUR;
    const cutoff168h = now - 168 * MS_HOUR;

    // Always protect first & last rows to preserve graph bounds
    const protectedIds = new Set<string>();
    protectedIds.add(allRows[0].id);
    protectedIds.add(allRows[allRows.length - 1].id);

    // Bucket size depends on age band. Keep oldest row per bucket; drop the rest.
    const idsToDelete: string[] = [];
    const seenBuckets = new Set<string>();

    for (const row of allRows) {
      const ts = new Date(row.recorded_at).getTime();
      if (ts >= cutoff6h) continue; // 0–6h: keep all
      if (protectedIds.has(row.id)) continue;

      let bucketMs: number;
      if (ts >= cutoff48h)       bucketMs = 15 * MS_MIN; // 6–48h
      else if (ts >= cutoff168h) bucketMs = 30 * MS_MIN; // 48–168h
      else                       bucketMs = 60 * MS_MIN; // 168h+

      const key = `${bucketMs}:${Math.floor(ts / bucketMs)}`;
      if (seenBuckets.has(key)) {
        idsToDelete.push(row.id);
      } else {
        seenBuckets.add(key);
      }
    }

    if (idsToDelete.length === 0) return;

    // Delete in batches of 500 (Supabase .in() limit)
    for (let i = 0; i < idsToDelete.length; i += 500) {
      const batch = idsToDelete.slice(i, i + 500);
      await supabase.from('brew_data_snapshots').delete().in('id', batch);
    }

    const kept = allRows.length - idsToDelete.length;
    console.log(`[Snapshots] Thinned ${idsToDelete.length} for brew ${brewId} (${allRows.length} → ${kept}, bands: 5m/15m/30m/60m)`);
  } catch (err) {
    console.error('Error in thinSnapshots:', err);
  }
}
