/**
 * Creates complete data snapshots for brew SG data points.
 * Each snapshot locks: date, SG, pill temp, controller temp, profile target (Mål), and auto target (PID).
 */

interface SgDataPoint {
  date: string;
  value: number;
  temp: number;
}

interface ProfileTargetPoint {
  timestamp: number;
  target: number;
}

/** Reconstruct profile target timeline from fermentation session + step logs */
async function getProfileTargetTimeline(
  supabase: any,
  brewId: string,
  controllerId: string
): Promise<ProfileTargetPoint[]> {
  try {
    // Find session by brew_id first, then controller_id
    let sessions: any[] | null = null;
    const { data: byBrew } = await supabase
      .from('fermentation_sessions')
      .select('id, profile_id, started_at')
      .eq('brew_id', brewId)
      .in('status', ['running', 'completed', 'paused', 'cancelled'])
      .order('started_at', { ascending: false })
      .limit(1);
    sessions = byBrew;

    if (!sessions?.length) {
      const { data: byCtrl } = await supabase
        .from('fermentation_sessions')
        .select('id, profile_id, started_at')
        .eq('controller_id', controllerId)
        .in('status', ['running', 'completed', 'paused', 'cancelled'])
        .order('started_at', { ascending: false })
        .limit(1);
      sessions = byCtrl;
    }

    if (!sessions?.[0]) return [];
    const session = sessions[0];

    const [stepsResult, stepLogsResult] = await Promise.all([
      supabase
        .from('fermentation_profile_steps')
        .select('step_order, step_type, target_temp, duration_hours')
        .eq('profile_id', session.profile_id)
        .order('step_order', { ascending: true }),
      supabase
        .from('fermentation_step_log')
        .select('step_index, created_at')
        .eq('session_id', session.id)
        .order('created_at', { ascending: true }),
    ]);

    const steps = stepsResult.data;
    const stepLogs = stepLogsResult.data;
    if (!steps || steps.length === 0) return [];

    const stepStartMap: Record<number, number> = {};
    stepStartMap[0] = new Date(session.started_at).getTime();
    if (stepLogs) {
      for (const log of stepLogs) {
        if (!(log.step_index in stepStartMap)) {
          stepStartMap[log.step_index] = new Date(log.created_at).getTime();
        }
      }
    }

    const timeline: ProfileTargetPoint[] = [];
    let lastTarget: number | null = null;

    for (const step of steps) {
      const startTime = stepStartMap[step.step_order];
      if (!startTime) continue;

      const stepTarget = step.target_temp ?? lastTarget;

      if (step.step_type === 'ramp' && step.duration_hours && stepTarget !== null && lastTarget !== null) {
        const durationMs = step.duration_hours * 3600 * 1000;
        const numPoints = Math.max(2, Math.ceil(step.duration_hours * 2));
        for (let i = 0; i <= numPoints; i++) {
          const t = i / numPoints;
          const ts = startTime + t * durationMs;
          const target = Math.round((lastTarget + (stepTarget - lastTarget) * Math.min(t, 1)) * 10) / 10;
          timeline.push({ timestamp: ts, target });
        }
      } else if (stepTarget !== null) {
        timeline.push({ timestamp: startTime, target: stepTarget });
      }

      if (stepTarget !== null) lastTarget = stepTarget;
    }

    return timeline;
  } catch (err) {
    console.error('Error reconstructing profile target timeline:', err);
    return [];
  }
}

/** Find profile target at a given timestamp from the timeline */
function getProfileTargetAt(timeline: ProfileTargetPoint[], ts: number): number | null {
  if (timeline.length === 0) return null;
  let result: number | null = null;
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (timeline[i].timestamp <= ts) {
      result = timeline[i].target;
      break;
    }
  }
  return result;
}

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

    // Fetch controller data and profile timeline
    let controllerData: any[] = [];
    let profileTimeline: ProfileTargetPoint[] = [];

    const sorted = [...sgData].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    const startTime = sorted[0].date;
    const endTime = sorted[sorted.length - 1].date;

    // Always fetch profile timeline; fetch controller data only if controllerId exists
    const promises: Promise<any>[] = [];

    if (controllerId) {
      promises.push(
        (async () => {
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
        })()
      );
    }

    promises.push(
      (async () => {
        profileTimeline = await getProfileTargetTimeline(supabase, brewId, controllerId ?? '');
      })()
    );

    await Promise.all(promises);

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

      // Profile target: prefer reconstructed timeline, fall back to stored value
      const profileTarget = getProfileTargetAt(profileTimeline, pointMs)
        ?? closest?.profile_target_temp
        ?? null;

      return {
        brew_id: brewId,
        recorded_at: point.date,
        sg: point.value,
        pill_temp: point.temp,
        controller_temp: closest?.current_temp ?? null,
        profile_target_temp: profileTarget,
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
