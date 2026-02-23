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

// Snapshot target lookup entry
interface SnapshotTarget {
  timestamp: number;
  profileTarget: number | null;
}

export function useBrewChartData({
  data,
  controllerId,
  brewId,
  smoothLines,
}: UseBrewChartDataProps): UseBrewChartDataReturn {
  const [controllerTempData, setControllerTempData] = useState<ControllerTempPoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [snapshotTargets, setSnapshotTargets] = useState<SnapshotTarget[]>([]);
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
      setSnapshotTargets([]);
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

        // Fetch snapshot targets for Mål line (locked, historically correct)
        if (brewId) {
          const { data: snapshots } = await supabase
            .from('brew_data_snapshots')
            .select('recorded_at, profile_target_temp')
            .eq('brew_id', brewId)
            .order('recorded_at', { ascending: true });

          if (snapshots && snapshots.length > 0) {
            setSnapshotTargets(
              snapshots.map(s => ({
                timestamp: new Date(s.recorded_at).getTime(),
                profileTarget: s.profile_target_temp,
              }))
            );
          } else {
            setSnapshotTargets([]);
          }
        }
      } finally {
        setIsLoading(false);
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

    // Apply profile target from snapshots (locked, historically correct)
    // This replaces the PID-adjusted target_temp with the actual profile target
    let mappedData = withSpan;

    if (snapshotTargets.length > 0) {
      // Build a Set for fast lookup by rounded timestamp (snapshots align with SG data points)
      const targetMap = new Map<number, number | null>();
      for (const st of snapshotTargets) {
        targetMap.set(st.timestamp, st.profileTarget);
      }

      mappedData = withSpan.map(point => {
        // Direct match first (snapshots and SG data share timestamps)
        const directTarget = targetMap.get(point.timestamp);
        if (directTarget !== undefined && directTarget !== null) {
          return { ...point, targetTemp: directTarget };
        }

        // Nearest snapshot fallback (step function: use last known target)
        let profileTarget: number | null = null;
        for (let i = snapshotTargets.length - 1; i >= 0; i--) {
          if (snapshotTargets[i].timestamp <= point.timestamp && snapshotTargets[i].profileTarget !== null) {
            profileTarget = snapshotTargets[i].profileTarget;
            break;
          }
        }
        if (profileTarget !== null) {
          return { ...point, targetTemp: profileTarget };
        }
        return point;
      });
    }

    return mappedData;
  }, [data, controllerTempData, smoothLines, isTvMode, snapshotTargets]);

  const dayBoundaries = useMemo(() => generateDayBoundaries(chartData), [chartData]);

  const dayTicks = useMemo(() => generateDayTicks(chartData), [chartData]);

  return {
    chartData,
    dayBoundaries,
    dayTicks,
    isLoading,
  };
}
