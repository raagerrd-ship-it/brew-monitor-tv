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
    // Falls back to current controller state when no history match (controller offline/gap)
    const snapshots = newPoints.map((point) => {
      const pointMs = new Date(point.date).getTime();
      const closest = findClosest(pointMs);

      return {
        brew_id: brewId,
        recorded_at: point.date,
        sg: point.value,
        pill_temp: point.temp,
        controller_temp: closest?.current_temp ?? currentControllerState?.current_temp ?? null,
        profile_target_temp: closest?.profile_target_temp ?? currentControllerState?.profile_target_temp ?? null,
        auto_target_temp: closest?.target_temp ?? currentControllerState?.target_temp ?? null,
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

    return snapshots.length;
  } catch (err) {
    console.error('Error in createBrewSnapshots:', err);
    return 0;
  }
}
