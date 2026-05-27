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

    // Fire-and-forget: consolidate closed 5-min buckets, then thin if oversized
    consolidate5MinBuckets(supabase, brewId).catch(() => {});
    thinSnapshots(supabase, brewId).catch(() => {});
    return true;
  } catch (err) {
    console.error('Error in createBrewSnapshot:', err);
    return false;
  }
}

/**
 * Consolidate snapshots into 5-minute averaged buckets.
 * For each closed 5-min bucket (i.e. not the current bucket), if it has >1 row,
 * replace them with a single row containing the average of all numeric columns,
 * timestamped at the bucket start.
 *
 * Effect: long-term storage = one averaged snapshot per 5 min, low-pass filtering
 * BLE jitter on pill_temp/sg and PWM ripple on actual_temp.
 */
export async function consolidate5MinBuckets(supabase: any, brewId: string): Promise<void> {
  try {
    const BUCKET_MS = 5 * 60 * 1000;
    const nowBucket = Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS;
    // Look back ~30 min — enough to catch the previous bucket plus any backfill,
    // small enough to keep the query cheap on every write.
    const lookbackStart = new Date(nowBucket - 6 * BUCKET_MS).toISOString();
    const lookbackEnd = new Date(nowBucket).toISOString(); // exclusive: skip current bucket

    const { data: rows } = await supabase
      .from('brew_data_snapshots')
      .select('id, recorded_at, sg, pill_temp, controller_temp, profile_target_temp, actual_temp, auto_target_temp')
      .eq('brew_id', brewId)
      .gte('recorded_at', lookbackStart)
      .lt('recorded_at', lookbackEnd)
      .order('recorded_at', { ascending: true });

    if (!rows || rows.length < 2) return;

    // Group by 5-min bucket start
    const buckets = new Map<number, typeof rows>();
    for (const r of rows) {
      const bs = Math.floor(new Date(r.recorded_at).getTime() / BUCKET_MS) * BUCKET_MS;
      const list = buckets.get(bs) || [];
      list.push(r);
      buckets.set(bs, list);
    }

    for (const [bucketStart, group] of buckets) {
      if (group.length < 2) continue; // already consolidated

      const avg = (key: string) => {
        const vals = group.map((g: any) => g[key]).filter((v: any) => v != null);
        if (vals.length === 0) return null;
        return vals.reduce((a: number, b: number) => a + b, 0) / vals.length;
      };

      const median = (key: string) => {
        const vals = group.map((g: any) => g[key]).filter((v: any) => v != null).sort((a: number, b: number) => a - b);
        if (vals.length === 1) return vals[0];
        if (vals.length === 0) return null;
        const mid = Math.floor(vals.length / 2);
        return vals.length % 2 === 0 ? (vals[mid - 1] + vals[mid]) / 2 : vals[mid];
      };

      const r2 = (v: number | null) => v == null ? null : Math.round(v * 100) / 100;
      const r4 = (v: number | null) => v == null ? null : Math.round(v * 10000) / 10000;

      const merged = {
        sg: r4(median('sg')),
        pill_temp: r2(avg('pill_temp')),
        controller_temp: r2(avg('controller_temp')),
        profile_target_temp: r2(avg('profile_target_temp')),
        actual_temp: r2(avg('actual_temp')),
        auto_target_temp: r2(avg('auto_target_temp')),
      };

      const keepId = group[0].id;
      const dropIds = group.slice(1).map((g: any) => g.id);
      const keepTs = new Date(bucketStart).toISOString();

      // Delete the redundant rows first to avoid the unique (brew_id, recorded_at) collision
      // when re-anchoring the survivor to the bucket start timestamp.
      if (dropIds.length > 0) {
        await supabase.from('brew_data_snapshots').delete().in('id', dropIds);
      }
      await supabase
        .from('brew_data_snapshots')
        .update({ ...merged, recorded_at: keepTs })
        .eq('id', keepId);
    }
  } catch (err) {
    console.error('Error in consolidate5MinBuckets:', err);
  }
}

/**
 * Snapshot thinning — preserves recent detail, caps long-term resolution at 1/hour.
 *
 * Age bands:
 *   < 6h     → keep all (5-min resolution, untouched)
 *   6h+      → thin to ~1 row per hour (never denser, never sparser)
 *
 * Runs every write. The 500-row cap is intentionally ignored: 1/hour is the
 * hard floor even if the total exceeds 500. First & last rows are always kept.
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
    const MS_6H = 6 * 60 * 60 * 1000;
    const MS_1H = 60 * 60 * 1000;
    const cutoff6h = now - MS_6H;

    // Always protect first & last rows to preserve graph bounds
    const protectedIds = new Set<string>();
    protectedIds.add(allRows[0].id);
    protectedIds.add(allRows[allRows.length - 1].id);

    // For rows older than 6h, keep at most one per hourly bucket (oldest in bucket wins).
    // Floor of 1/hour is enforced — never thin denser than that.
    const idsToDelete: string[] = [];
    const seenHourBuckets = new Set<number>();

    for (const row of allRows) {
      const ts = new Date(row.recorded_at).getTime();
      if (ts >= cutoff6h) continue; // recent 6h: keep all
      if (protectedIds.has(row.id)) continue;

      const hourBucket = Math.floor(ts / MS_1H);
      if (seenHourBuckets.has(hourBucket)) {
        idsToDelete.push(row.id);
      } else {
        seenHourBuckets.add(hourBucket);
      }
    }

    if (idsToDelete.length === 0) return;

    // Delete in batches of 500 (Supabase .in() limit)
    for (let i = 0; i < idsToDelete.length; i += 500) {
      const batch = idsToDelete.slice(i, i + 500);
      await supabase.from('brew_data_snapshots').delete().in('id', batch);
    }

    const kept = allRows.length - idsToDelete.length;
    console.log(`[Snapshots] Thinned ${idsToDelete.length} for brew ${brewId} (${allRows.length} → ${kept}, 1/hour floor beyond 6h)`);
  } catch (err) {
    console.error('Error in thinSnapshots:', err);
  }
}
