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

interface SnapshotTarget {
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
  const [snapshotTargets, setSnapshotTargets] = useState<SnapshotTarget[]>([]);
  const { isTvMode } = useTvMode();
  
  const lastFetchKey = useRef<string>("");

  const dataLength = data?.length ?? 0;
  const firstDataDate = dataLength > 0 ? data[0].date : "";
  const lastDataDate = dataLength > 0 ? data[dataLength - 1].date : "";

  useEffect(() => {
    if (!controllerId || dataLength === 0) {
      if (controllerTempData.length > 0) {
        setControllerTempData([]);
      }
      setSnapshotTargets([]);
      return;
    }

    const fetchKey = `${controllerId}-${brewId}-${firstDataDate}-${lastDataDate}`;
    if (fetchKey === lastFetchKey.current) return;

    const fetchData = async () => {
      lastFetchKey.current = fetchKey;
      setIsLoading(true);
      try {
        // Fetch controller temp history (for gradient/area) and snapshot targets (for Mål line) in parallel
        const controllerPromise = (async () => {
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

            if (error) { hasMore = false; }
            else if (!tempHistory || tempHistory.length === 0) { hasMore = false; }
            else {
              allRows.push(...tempHistory);
              offset += batchSize;
              hasMore = tempHistory.length === batchSize;
            }
          }
          return allRows;
        })();

        const snapshotsPromise = brewId
          ? (async () => {
              const allSnapshots: any[] = [];
              let offset = 0;
              const batchSize = 1000;
              let hasMore = true;
              while (hasMore) {
                const { data: batch } = await supabase
                  .from('brew_data_snapshots')
                  .select('recorded_at, profile_target_temp')
                  .eq('brew_id', brewId)
                  .not('profile_target_temp', 'is', null)
                  .order('recorded_at', { ascending: true })
                  .range(offset, offset + batchSize - 1);
                if (!batch || batch.length === 0) { hasMore = false; }
                else {
                  allSnapshots.push(...batch);
                  offset += batchSize;
                  hasMore = batch.length === batchSize;
                }
              }
              return allSnapshots;
            })()
          : Promise.resolve([] as any[]);

        const [ctrlRows, snapshotsResult] = await Promise.all([controllerPromise, snapshotsPromise]);

        if (ctrlRows.length > 0) setControllerTempData(ctrlRows);

        const snapshots = snapshotsResult;
        if (snapshots && snapshots.length > 0) {
          setSnapshotTargets(
            snapshots.map((s: any) => ({
              timestamp: new Date(s.recorded_at).getTime(),
              target: s.profile_target_temp as number,
            }))
          );
        } else {
          setSnapshotTargets([]);
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();

    if (isTvMode) {
      const intervalId = setInterval(() => {
        lastFetchKey.current = "";
        fetchData();
      }, 300000);
      return () => clearInterval(intervalId);
    }
  }, [controllerId, brewId, dataLength, firstDataDate, lastDataDate, isTvMode]);

  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];

    const sourceData = isTvMode ? downsampleForTvMode(data, 80) : data;
    const controllerDataSampled = isTvMode
      ? downsampleForTvMode(controllerTempData, 80)
      : controllerTempData;

    const dataWithControllerTemp = mergeWithControllerTemp(sourceData, controllerDataSampled);
    const windowSize = getOptimalWindowSize(dataWithControllerTemp.length);
    const smoothedData = calculateMovingAverage(dataWithControllerTemp, windowSize, smoothLines);
    const withTimestamps = addTimestamps(smoothedData);
    const withSpan = withTimestamps.map(point => ({
      ...point,
      tempSpan: (point.controllerTemp != null && point.pillTemp != null)
        ? Math.abs(point.pillTemp - point.controllerTemp)
        : null,
    }));

    // Apply Mål from snapshots (brew_data_snapshots.profile_target_temp)
    // Falls back to controller history target_temp until snapshots are populated
    let mappedData = withSpan;

    if (snapshotTargets.length > 0) {
      mappedData = withSpan.map(point => {
        // Step function: find last snapshot target at or before this timestamp
        let target: number | null = null;
        for (let i = snapshotTargets.length - 1; i >= 0; i--) {
          if (snapshotTargets[i].timestamp <= point.timestamp) {
            target = snapshotTargets[i].target;
            break;
          }
        }
        return target !== null ? { ...point, targetTemp: target } : point;
      });
    }

    return mappedData;
  }, [data, controllerTempData, smoothLines, isTvMode, snapshotTargets]);

  const dayBoundaries = useMemo(() => generateDayBoundaries(chartData), [chartData]);
  const dayTicks = useMemo(() => generateDayTicks(chartData), [chartData]);

  return { chartData, dayBoundaries, dayTicks, isLoading };
}
