import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTvMode } from "@/contexts/TvModeContext";
import { ControllerTempPoint, ChartDataPointWithTimestamp } from "../types";
import {
  calculateMovingAverage,
  addTimestamps,
  generateDayBoundaries,
  generateDayTicks,
  getOptimalWindowSize,
  mergeWithControllerTemp,
  downsampleForTvMode,
} from "../utils";

interface SGDataPoint {
  date: string;
  value: number;
  temp: number;
}

interface UseBrewChartDataProps {
  data: SGDataPoint[];
  controllerId?: string;
  brewId?: string;
  smoothLines: boolean;
}

interface UseBrewChartDataReturn {
  chartData: ChartDataPointWithTimestamp[];
  dayBoundaries: number[];
  dayTicks: number[];
  isLoading: boolean;
}

// Profile target timeline entry
interface ProfileTargetPoint {
  timestamp: number;
  target: number;
}

export function useBrewChartData({
  data,
  controllerId,
  brewId,
  smoothLines,
}: UseBrewChartDataProps): UseBrewChartDataReturn {
  const [controllerTempData, setControllerTempData] = useState<ControllerTempPoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [profileTargets, setProfileTargets] = useState<ProfileTargetPoint[]>([]);
  const { isTvMode } = useTvMode();
  
  // Use ref to track if we've already fetched for this controller/data combo
  const lastFetchKey = useRef<string>("");

  // Stable data length for dependency tracking (avoids re-render on same-content arrays)
  const dataLength = data?.length ?? 0;
  const firstDataDate = dataLength > 0 ? data[0].date : "";
  const lastDataDate = dataLength > 0 ? data[dataLength - 1].date : "";

  // Fetch controller temperature history when controllerId is provided
  useEffect(() => {
    // Skip if no data or no controller
    if (!controllerId || dataLength === 0) {
      if (controllerTempData.length > 0) {
        setControllerTempData([]);
      }
      setProfileTargets([]);
      return;
    }

    // Create a key to detect if we need to refetch
    const fetchKey = `${controllerId}-${brewId}-${firstDataDate}-${lastDataDate}`;
    if (fetchKey === lastFetchKey.current) {
      return; // Already fetched this data
    }

    const fetchControllerTemp = async () => {
      lastFetchKey.current = fetchKey;
      setIsLoading(true);
      try {
        // Paginate to bypass PostgREST max_rows (1000) limit
        const allRows: ControllerTempPoint[] = [];
        let offset = 0;
        const batchSize = 1000;
        let hasMore = true;

        while (hasMore) {
          const { data: tempHistory, error } = await supabase.rpc("get_temp_history_sampled", {
            p_controller_id: controllerId,
            p_start_time: firstDataDate,
            p_end_time: lastDataDate,
            p_sample_interval_minutes: 15,
          }).range(offset, offset + batchSize - 1);

          if (error) {
            console.error("Error fetching controller temp history:", error);
            hasMore = false;
          } else if (!tempHistory || tempHistory.length === 0) {
            hasMore = false;
          } else {
            allRows.push(...tempHistory);
            offset += batchSize;
            hasMore = tempHistory.length === batchSize;
          }
        }

        if (allRows.length > 0) {
          setControllerTempData(allRows);
        }

        // Fetch fermentation session + profile steps to build profile target timeline
        await fetchProfileTargetTimeline(controllerId);
      } finally {
        setIsLoading(false);
      }
    };

    const fetchProfileTargetTimeline = async (ctrlId: string) => {
      try {
        // Find fermentation session for this brew (or fall back to controller)
        let query = supabase
          .from('fermentation_sessions')
          .select('id, profile_id, started_at, current_step_index')
          .in('status', ['running', 'completed', 'paused', 'cancelled'])
          .order('started_at', { ascending: false })
          .limit(1);

        if (brewId) {
          query = query.eq('brew_id', brewId);
        } else {
          query = query.eq('controller_id', ctrlId);
        }

        const { data: sessions } = await query;

        if (!sessions?.[0]) {
          setProfileTargets([]);
          return;
        }

        const session = sessions[0];

        // Fetch profile steps and step logs in parallel
        // Use ALL log actions (not just 'started') to find step start times,
        // since ramp steps may only have 'temp_adjusted' entries
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
        if (!steps || steps.length === 0) {
          setProfileTargets([]);
          return;
        }

        // Build step start time map (earliest log entry per step, any action type)
        const stepStartMap: Record<number, number> = {};
        stepStartMap[0] = new Date(session.started_at).getTime();
        if (stepLogs) {
          for (const log of stepLogs) {
            if (!(log.step_index in stepStartMap)) {
              stepStartMap[log.step_index] = new Date(log.created_at).getTime();
            }
          }
        }

        // Build profile target timeline
        const timeline: ProfileTargetPoint[] = [];
        let lastTarget: number | null = null;

        for (const step of steps) {
          const startTime = stepStartMap[step.step_order];
          if (!startTime) continue; // step hasn't started yet, skip to next

          const stepTarget = step.target_temp ?? lastTarget;

        if (step.step_type === 'ramp' && step.duration_hours && stepTarget !== null && lastTarget !== null) {
            // Ramp: generate intermediate points (every 30 min), capped at current time
            const durationMs = step.duration_hours * 3600 * 1000;
            const now = Date.now();
            const endTime = Math.min(startTime + durationMs, now);
            const numPoints = Math.max(2, Math.ceil(step.duration_hours * 2));
            for (let i = 0; i <= numPoints; i++) {
              const t = i / numPoints;
              const ts = startTime + t * durationMs;
              if (ts > now) break; // Don't project ramp into the future
              const target = Math.round((lastTarget + (stepTarget - lastTarget) * Math.min(t, 1)) * 10) / 10;
              timeline.push({ timestamp: ts, target });
            }
          } else if (stepTarget !== null) {
            // Hold/wait: flat line at target
            timeline.push({ timestamp: startTime, target: stepTarget });
          }

          if (stepTarget !== null) lastTarget = stepTarget;
        }

        setProfileTargets(timeline);
      } catch (err) {
        console.error("Error fetching profile target timeline:", err);
        setProfileTargets([]);
      }
    };

    fetchControllerTemp();

    // In TV mode, refresh controller temp data every 5 minutes (300s) for performance
    // In normal mode, no auto-refresh (realtime handles it)
    if (isTvMode) {
      const intervalId = setInterval(() => {
        lastFetchKey.current = ""; // Force refetch
        fetchControllerTemp();
      }, 300000); // 5 minutes
      return () => clearInterval(intervalId);
    }
  }, [controllerId, brewId, dataLength, firstDataDate, lastDataDate, isTvMode]);

  // Memoize all expensive calculations
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];

    // Downsample early in TV mode to reduce all subsequent calculations
    const sourceData = isTvMode ? downsampleForTvMode(data, 80) : data;
    const controllerDataSampled = isTvMode
      ? downsampleForTvMode(controllerTempData, 80)
      : controllerTempData;

    const dataWithControllerTemp = mergeWithControllerTemp(sourceData, controllerDataSampled);
    const windowSize = getOptimalWindowSize(dataWithControllerTemp.length);
    const smoothedData = calculateMovingAverage(dataWithControllerTemp, windowSize, smoothLines);
    const withTimestamps = addTimestamps(smoothedData);
    // Compute tempSpan from smoothed values for stacked area rendering
    const withSpan = withTimestamps.map(point => ({
      ...point,
      tempSpan: (point.controllerTemp != null && point.pillTemp != null)
        ? Math.abs(point.pillTemp - point.controllerTemp)
        : null,
    }));

    // Override targetTemp with fermentation profile targets if available,
    // otherwise hide the target line (raw controller targets are noisy from auto-cooling)
    const mappedData = withSpan.map(point => {
      if (profileTargets.length > 0 && point.controllerTemp != null) {
        let profileTarget: number | null = null;
        for (let i = profileTargets.length - 1; i >= 0; i--) {
          if (profileTargets[i].timestamp <= point.timestamp) {
            profileTarget = profileTargets[i].target;
            break;
          }
        }
        return profileTarget !== null ? { ...point, targetTemp: profileTarget } : point;
      }
      // No profile: hide target line (raw controller targets are noisy from auto-cooling)
      return { ...point, targetTemp: null };
    });

    return mappedData;

    // This return is now unreachable but kept for safety
    return withSpan;
  }, [data, controllerTempData, smoothLines, isTvMode, profileTargets]);

  const dayBoundaries = useMemo(() => generateDayBoundaries(chartData), [chartData]);

  const dayTicks = useMemo(() => generateDayTicks(chartData), [chartData]);

  return {
    chartData,
    dayBoundaries,
    dayTicks,
    isLoading,
  };
}
