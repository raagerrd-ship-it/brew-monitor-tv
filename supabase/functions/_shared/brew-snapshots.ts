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
    const resolvedActualTemp = data.actual_temp ?? pill_temp ?? controller_temp ?? null;

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

    const now = Date.now();
    const MS_24H  = 24 * 60 * 60 * 1000;
    const MS_7D   =  7 * 24 * 60 * 60 * 1000;
    const MS_30D  = 30 * 24 * 60 * 60 * 1000;

    // Split into age bands
    const bands: { rows: typeof allRows; keepEvery: number }[] = [
      { rows: [], keepEvery: 1 },  // <24h — keep all
      { rows: [], keepEvery: 2 },  // 1-7d
      { rows: [], keepEvery: 4 },  // 7-30d
      { rows: [], keepEvery: 8 },  // 30d+
    ];

    for (const row of allRows) {
      const age = now - new Date(row.recorded_at).getTime();
      if (age < MS_24H) bands[0].rows.push(row);
      else if (age < MS_7D) bands[1].rows.push(row);
      else if (age < MS_30D) bands[2].rows.push(row);
      else bands[3].rows.push(row);
    }

    const idsToDelete: string[] = [];

    for (const band of bands) {
      if (band.keepEvery <= 1 || band.rows.length <= 2) continue;
      // Always keep first and last in each band
      for (let i = 1; i < band.rows.length - 1; i++) {
        if (i % band.keepEvery !== 0) {
          idsToDelete.push(band.rows[i].id);
        }
      }
    }

    if (idsToDelete.length === 0) return;

    // Delete in batches of 500 (Supabase .in() limit)
    for (let i = 0; i < idsToDelete.length; i += 500) {
      const batch = idsToDelete.slice(i, i + 500);
      await supabase.from('brew_data_snapshots').delete().in('id', batch);
    }

    console.log(`[Snapshots] Thinned ${idsToDelete.length} old snapshots for brew ${brewId} (${allRows.length} → ${allRows.length - idsToDelete.length})`);
  } catch (err) {
    console.error('Error in thinSnapshots:', err);
  }
}
