import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";

interface SgDataPoint {
  date: string;
  value: number;
  temp: number;
}

interface ControllerTempPoint {
  recorded_at: string;
  current_temp: number;
  target_temp: number;
  profile_target_temp?: number | null;
}

interface ProfileTargetPoint {
  timestamp: number;
  target: number;
}

interface MergedDataPoint {
  date: string;
  sg: number;
  pillTemp: number;
  controllerTemp: number | null;
  targetTemp: number | null;
  profileTarget: number | null;
}

interface SyncedDataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brewName: string;
  sgData: SgDataPoint[];
  controllerId?: string | null;
}

/** Build a fermentation profile target timeline from session data */
async function fetchProfileTargetTimeline(controllerId: string): Promise<ProfileTargetPoint[]> {
  try {
    const { data: sessions } = await supabase
      .from('fermentation_sessions')
      .select('id, profile_id, started_at, current_step_index')
      .eq('controller_id', controllerId)
      .in('status', ['running', 'completed', 'paused'])
      .order('started_at', { ascending: false })
      .limit(1);

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

    // Build step start time map (earliest log entry per step)
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
  } catch {
    return [];
  }
}

function lookupProfileTarget(timeline: ProfileTargetPoint[], timestampMs: number): number | null {
  if (timeline.length === 0) return null;
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (timeline[i].timestamp <= timestampMs) {
      return timeline[i].target;
    }
  }
  return null;
}

export function SyncedDataDialog({
  open,
  onOpenChange,
  brewName,
  sgData,
  controllerId,
}: SyncedDataDialogProps) {
  const [controllerData, setControllerData] = useState<ControllerTempPoint[]>([]);
  const [profileTargets, setProfileTargets] = useState<ProfileTargetPoint[]>([]);

  // Fetch controller temperature data and profile targets when dialog opens
  useEffect(() => {
    if (!open || !controllerId || sgData.length === 0) {
      setControllerData([]);
      setProfileTargets([]);
      return;
    }

    const fetchData = async () => {
      const sortedSg = [...sgData].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );
      const startTime = sortedSg[0].date;
      let endTime = sortedSg[sortedSg.length - 1].date;

      const startMs = new Date(startTime).getTime();
      const endMs = new Date(endTime).getTime();
      if (endMs - startMs < 30 * 60 * 1000) {
        endTime = new Date(startMs + 30 * 60 * 1000).toISOString();
      }

      // Fetch controller temp and profile targets in parallel
      const [ctrlResult, profileTimeline] = await Promise.all([
        (async () => {
          const allRows: ControllerTempPoint[] = [];
          let offset = 0;
          const batchSize = 1000;
          let hasMore = true;

          while (hasMore) {
            const { data, error } = await supabase.rpc("get_temp_history_sampled", {
              p_controller_id: controllerId,
              p_start_time: startTime,
              p_end_time: endTime,
              p_sample_interval_minutes: 15,
            }).range(offset, offset + batchSize - 1);

            if (error || !data || data.length === 0) {
              hasMore = false;
            } else {
              allRows.push(...data);
              offset += batchSize;
              hasMore = data.length === batchSize;
            }
          }
          return allRows;
        })(),
        fetchProfileTargetTimeline(controllerId),
      ]);

      if (ctrlResult.length > 0) setControllerData(ctrlResult);
      setProfileTargets(profileTimeline);
    };

    fetchData();
  }, [open, controllerId, sgData]);

  // Merge sg_data with controller temp data using nearest-neighbor search
  const mergedData = useMemo(() => {
    const sortedCtrl = [...controllerData]
      .map(c => ({ ...c, ts: new Date(c.recorded_at).getTime() }))
      .sort((a, b) => a.ts - b.ts);

    const MAX_GAP_MS = 20 * 60 * 1000;

    const findClosest = (targetMs: number): ControllerTempPoint | null => {
      if (sortedCtrl.length === 0) return null;
      let lo = 0, hi = sortedCtrl.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sortedCtrl[mid].ts < targetMs) lo = mid + 1;
        else hi = mid;
      }
      let best = sortedCtrl[lo];
      if (lo > 0 && Math.abs(sortedCtrl[lo - 1].ts - targetMs) < Math.abs(best.ts - targetMs)) {
        best = sortedCtrl[lo - 1];
      }
      return Math.abs(best.ts - targetMs) <= MAX_GAP_MS ? best : null;
    };

    const merged: MergedDataPoint[] = sgData.map((point) => {
      const pointMs = new Date(point.date).getTime();
      const closest = findClosest(pointMs);
      const profTarget = lookupProfileTarget(profileTargets, pointMs);

      // Mål = stored profile_target_temp > reconstructed profile > fixed target
      const profileTarget = closest?.profile_target_temp ?? profTarget ?? closest?.target_temp ?? null;

      return {
        date: point.date,
        sg: point.value,
        pillTemp: point.temp,
        controllerTemp: closest?.current_temp ?? null,
        targetTemp: closest?.target_temp ?? null,
        profileTarget: profileTarget,
      };
    });

    return merged.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }, [sgData, controllerData, profileTargets]);

  const hasControllerData = controllerId && controllerData.length > 0;
  const hasAutoAdjustments = hasControllerData && (
    profileTargets.length > 0 || controllerData.some(d => d.profile_target_temp != null)
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] px-3 sm:px-4">
        <DialogHeader>
          <DialogTitle>Synkad data - {brewName}</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground mb-2">
          {sgData.length} mätpunkter
        </div>
        <ScrollArea className="h-[400px] pr-2">
          <div className="space-y-1">
            {mergedData.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                Ingen synkad data ännu
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b">
                    <th className="text-left py-2 font-medium">Datum</th>
                    <th className="text-right py-2 font-medium">SG</th>
                    <th className="text-right py-2 font-medium">Pill</th>
                    {hasControllerData && (
                      <th className="text-right py-2 font-medium">Ctrl</th>
                    )}
                    {hasControllerData && (
                      <th className="text-right py-2 font-medium">Mål</th>
                    )}
                    {hasAutoAdjustments && (
                      <th className="text-right py-2 font-medium">Auto</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {mergedData.map((point, index) => (
                    <tr
                      key={point.date}
                      className={`border-b border-border/50 ${
                        index === 0 ? "bg-primary/5" : ""
                      }`}
                    >
                      <td className="py-1.5 text-muted-foreground">
                        {format(new Date(point.date), "d MMM HH:mm", {
                          locale: sv,
                        })}
                      </td>
                      <td className="py-1.5 text-right font-mono text-beer-amber">
                        {point.sg.toFixed(4)}
                      </td>
                      <td className="py-1.5 text-right font-mono text-temp-blue">
                        {point.pillTemp.toFixed(1)}°
                      </td>
                      {hasControllerData && (
                        <td className="py-1.5 text-right font-mono text-orange-400">
                          {point.controllerTemp !== null
                            ? `${point.controllerTemp.toFixed(1)}°`
                            : "-"}
                        </td>
                      )}
                      {hasControllerData && (
                        <td className="py-1.5 text-right font-mono text-muted-foreground">
                          {point.profileTarget !== null
                            ? `${point.profileTarget.toFixed(1)}°`
                            : "-"}
                        </td>
                      )}
                      {hasAutoAdjustments && (
                        <td className="py-1.5 text-right font-mono text-muted-foreground/60">
                          {point.targetTemp !== null
                            ? `${point.targetTemp.toFixed(1)}°`
                            : "-"}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}