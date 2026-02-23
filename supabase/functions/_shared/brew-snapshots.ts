/**
 * Creates complete data snapshots for brew SG data points.
 * Each snapshot locks: date, SG, pill temp, controller temp, profile target (Mål), and auto target (PID).
 */

interface SgDataPoint {
  date: string;
  value: number;
  temp: number;
}

export async function createBrewSnapshots(
  supabase: any,
  brewId: string,
  controllerId: string | null,
  sgData: SgDataPoint[]
): Promise<number> {
  if (!sgData || sgData.length === 0) return 0;

  try {
    // Check which snapshots already exist
    const { data: existingSnapshots } = await supabase
      .from('brew_data_snapshots')
      .select('recorded_at')
      .eq('brew_id', brewId);

    const existingTimes = new Set(
      (existingSnapshots || []).map((s: any) => new Date(s.recorded_at).getTime())
    );

    const newPoints = sgData.filter(
      (p) => !existingTimes.has(new Date(p.date).getTime())
    );
    if (newPoints.length === 0) return 0;

    // Fetch controller data if linked
    let controllerData: any[] = [];
    if (controllerId) {
      const sorted = [...sgData].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );
      const startTime = sorted[0].date;
      const endTime = sorted[sorted.length - 1].date;

      const { data } = await supabase.rpc('get_temp_history_sampled', {
        p_controller_id: controllerId,
        p_start_time: startTime,
        p_end_time: endTime,
        p_sample_interval_minutes: 15,
      });
      controllerData = data || [];
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

    // Create snapshot records
    const snapshots = newPoints.map((point) => {
      const pointMs = new Date(point.date).getTime();
      const closest = findClosest(pointMs);

      return {
        brew_id: brewId,
        recorded_at: point.date,
        sg: point.value,
        pill_temp: point.temp,
        controller_temp: closest?.current_temp ?? null,
        profile_target_temp: closest?.profile_target_temp ?? closest?.target_temp ?? null,
        auto_target_temp: closest?.target_temp ?? null,
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
