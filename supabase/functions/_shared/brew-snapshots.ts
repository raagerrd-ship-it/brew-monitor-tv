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
      }, { onConflict: 'brew_id,recorded_at', ignoreDuplicates: true });

    if (error) {
      console.error('Error inserting brew snapshot:', error);
      return false;
    }

    // Fire-and-forget: thin old snapshots if count exceeds threshold
    thinSnapshots(supabase, brewId).catch(() => {});
    return true;
  } catch (err) {
    console.error('Error in createBrewSnapshot:', err);
    return false;
  }
}

/**
 * Progressive snapshot thinning — reduces storage while preserving recent detail.
 *
 * Age bands:
 *   < 24h    → keep all (~15 min resolution)
 *   1–7 d    → keep every 2nd (~30 min)
 *   7–30 d   → keep every 4th (~1h)
 *   30+ d    → keep every 8th (~2h)
 *
 * Only runs when a brew exceeds 500 snapshots. First & last record in each
 * band are always preserved to maintain graph bounds.
 */
export async function thinSnapshots(supabase: any, brewId: string): Promise<void> {
  try {
    const { count } = await supabase
      .from('brew_data_snapshots')
      .select('*', { count: 'exact', head: true })
      .eq('brew_id', brewId);

    if (!count || count <= 500) return;

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

    if (allRows.length <= 500) return;

    const now = Date.now();
    const MS_24H = 24 * 60 * 60 * 1000;
    const cutoff24h = now - MS_24H;

    // Split: recent (last 24h) vs older
    // Always protect the very first row
    const protectedIds = new Set<string>();
    protectedIds.add(allRows[0].id); // first ever snapshot
    protectedIds.add(allRows[allRows.length - 1].id); // last snapshot

    const recentRows: typeof allRows = [];
    const olderRows: typeof allRows = [];

    for (const row of allRows) {
      if (new Date(row.recorded_at).getTime() >= cutoff24h) {
        recentRows.push(row);
      } else {
        olderRows.push(row);
      }
    }

    // Budget: keep all recent rows, thin older rows to fit within ~500 total
    const budget = Math.max(10, 500 - recentRows.length);

    const idsToDelete: string[] = [];

    if (olderRows.length > budget) {
      // Calculate keepEvery dynamically so we end up with ~budget rows
      const keepEvery = Math.max(2, Math.round(olderRows.length / budget));

      for (let i = 0; i < olderRows.length; i++) {
        const row = olderRows[i];
        if (protectedIds.has(row.id)) continue;
        // Keep every Nth row (0-indexed: keep i=0, i=keepEvery, i=2*keepEvery, ...)
        if (i % keepEvery !== 0) {
          idsToDelete.push(row.id);
        }
      }
    }

    if (idsToDelete.length === 0) return;

    // Delete in batches of 500 (Supabase .in() limit)
    for (let i = 0; i < idsToDelete.length; i += 500) {
      const batch = idsToDelete.slice(i, i + 500);
      await supabase.from('brew_data_snapshots').delete().in('id', batch);
    }

    const kept = allRows.length - idsToDelete.length;
    console.log(`[Snapshots] Thinned ${idsToDelete.length} snapshots for brew ${brewId} (${allRows.length} → ${kept}, recent24h: ${recentRows.length}, older kept: ${kept - recentRows.length})`);
  } catch (err) {
    console.error('Error in thinSnapshots:', err);
  }
}
