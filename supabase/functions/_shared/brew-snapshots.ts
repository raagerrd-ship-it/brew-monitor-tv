/**
 * Creates complete data snapshots for brew SG data points.
 * Each snapshot locks: date, SG, pill temp, controller temp, profile target (Mål), and auto target (PID).
 * All values come directly from existing database records — no post-hoc calculation.
 */

import type { SgDataPoint } from './types.ts'

export async function createBrewSnapshots(
  supabase: any,
  brewId: string,
  controllerId: string | null,
  sgData: SgDataPoint[]
): Promise<number> {
  if (!sgData || sgData.length === 0) return 0;

  try {
    // Check which snapshots already exist (paginated to handle >1000)
    const existingTimes = new Set<number>();
    {
      let offset = 0;
      const batchSize = 1000;
      let hasMore = true;
      while (hasMore) {
        const { data: batch } = await supabase
          .from('brew_data_snapshots')
          .select('recorded_at')
          .eq('brew_id', brewId)
          .range(offset, offset + batchSize - 1);
        if (!batch || batch.length === 0) { hasMore = false; }
        else {
          for (const s of batch) existingTimes.add(new Date(s.recorded_at).getTime());
          offset += batchSize;
          hasMore = batch.length === batchSize;
        }
      }
    }

    const newPoints = sgData.filter(
      (p) => !existingTimes.has(new Date(p.date).getTime())
    );
    if (newPoints.length === 0) return 0;

    // Fetch controller data if controllerId exists
    let controllerData: any[] = [];

    const sorted = [...sgData].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    const startTime = sorted[0].date;
    const endTime = sorted[sorted.length - 1].date;

    if (controllerId) {
      const allRows: any[] = [];
      let offset = 0;
      const batchSize = 1000;
      let hasMore = true;
      while (hasMore) {
        const { data, error } = await supabase.rpc('get_temp_history_sampled', {
          p_controller_id: controllerId,
          p_start_time: startTime,
          p_end_time: endTime,
          p_sample_interval_minutes: 15,
        }).range(offset, offset + batchSize - 1);
        if (error || !data || data.length === 0) { hasMore = false; }
        else {
          allRows.push(...data);
          offset += batchSize;
          hasMore = data.length === batchSize;
        }
      }
      controllerData = allRows;
    }

    // Fetch current controller state as fallback when no history match exists
    let currentControllerState: { current_temp: number | null; target_temp: number | null; profile_target_temp: number | null } | null = null;
    if (controllerId) {
      const { data: ctrlCurrent } = await supabase
        .from('rapt_temp_controllers')
        .select('current_temp, target_temp, profile_target_temp')
        .eq('controller_id', controllerId)
        .maybeSingle();
      currentControllerState = ctrlCurrent;
    }

    // Build sorted controller data for nearest-neighbor lookup
    const sortedCtrl = controllerData
      .map((c: any) => ({ ...c, ts: new Date(c.recorded_at).getTime() }))
      .sort((a: any, b: any) => a.ts - b.ts);

    const MAX_GAP_MS = 20 * 60 * 1000;

    const findClosest = (targetMs: number): any | null => {
      if (sortedCtrl.length === 0) return null;
      let lo = 0,
        hi = sortedCtrl.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sortedCtrl[mid].ts < targetMs) lo = mid + 1;
        else hi = mid;
      }
      let best = sortedCtrl[lo];
      if (
        lo > 0 &&
        Math.abs(sortedCtrl[lo - 1].ts - targetMs) <
          Math.abs(best.ts - targetMs)
      ) {
        best = sortedCtrl[lo - 1];
      }
      return Math.abs(best.ts - targetMs) <= MAX_GAP_MS ? best : null;
    };

    // Create snapshot records — all values taken directly from stored data
    // Snapshots are now created AFTER automation (PID) has run and temp history
    // has been written, so currentControllerState reflects the final values.
    const snapshots = newPoints.map((point) => {
      const pointMs = new Date(point.date).getTime();
      const closest = findClosest(pointMs);

      const ctrlTemp = closest?.current_temp ?? currentControllerState?.current_temp ?? null;
      const pillTemp = point.temp;
      const avgTemp = (pillTemp != null && ctrlTemp != null)
        ? (pillTemp + ctrlTemp) / 2
        : pillTemp ?? ctrlTemp ?? null;

      return {
        brew_id: brewId,
        recorded_at: point.date,
        sg: point.value,
        pill_temp: pillTemp,
        controller_temp: ctrlTemp,
        // Mål = profilmålet, låst från kontrollerns aktuella state
        profile_target_temp: currentControllerState?.profile_target_temp ?? closest?.profile_target_temp ?? null,
        // Fusionerad medeltemp (pill + ctrl) / 2
        auto_target_temp: avgTemp,
      };
    });

    if (snapshots.length > 0) {
      const { error } = await supabase
        .from('brew_data_snapshots')
        .upsert(snapshots, { onConflict: 'brew_id,recorded_at', ignoreDuplicates: true });

      if (error) {
        console.error('Error inserting brew snapshots:', error);
        return 0;
      }
      console.log(`Created ${snapshots.length} data snapshots for brew ${brewId}`);
    }

    // Fire-and-forget: thin old snapshots if count exceeds threshold
    thinSnapshots(supabase, brewId).catch(() => {});

    return snapshots.length;
  } catch (err) {
    console.error('Error in createBrewSnapshots:', err);
    return 0;
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
