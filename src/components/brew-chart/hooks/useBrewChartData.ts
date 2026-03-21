import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTvMode } from "@/contexts/TvModeContext";
import { ChartDataPointWithTimestamp } from "../types";
import {
  addTimestamps,
  generateDayBoundaries,
  generateDayTicks,
  calculateMovingAverage,
  getOptimalWindowSize,
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
  pillCompensation?: boolean;
}

interface UseBrewChartDataReturn {
  chartData: ChartDataPointWithTimestamp[];
  dayBoundaries: number[];
  dayTicks: number[];
  isLoading: boolean;
}

interface SnapshotRow {
  recorded_at: string;
  sg: number;
  pill_temp: number;
  controller_temp: number | null;
  profile_target_temp: number | null;
}

export function useBrewChartData({
  data,
  controllerId: _controllerId,
  brewId,
  smoothLines,
  pillCompensation = true,
}: UseBrewChartDataProps): UseBrewChartDataReturn {
  const [snapshotRows, setSnapshotRows] = useState<SnapshotRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { isTvMode } = useTvMode();
  const lastFetchKey = useRef<string>("");

  const dataLength = data?.length ?? 0;
  const firstDataDate = dataLength > 0 ? data[0].date : "";
  const lastDataDate = dataLength > 0 ? data[dataLength - 1].date : "";

  useEffect(() => {
    if (!brewId) {
      setSnapshotRows((prev) => (prev.length > 0 ? [] : prev));
      return;
    }

    const fetchKey = `${brewId}-${firstDataDate}-${lastDataDate}`;
    if (fetchKey === lastFetchKey.current) return;

    const fetchData = async () => {
      lastFetchKey.current = fetchKey;
      setIsLoading(true);
      try {
        // Thinning policy caps snapshots at ~500 per brew, no pagination needed
        const { data: batch, error } = await supabase
          .from("brew_data_snapshots")
          .select("recorded_at, sg, pill_temp, controller_temp, profile_target_temp")
          .eq("brew_id", brewId)
          .order("recorded_at", { ascending: true });

        if (error) {
          console.error("[useBrewChartData] Failed to fetch snapshots:", error);
        }

        setSnapshotRows((batch as SnapshotRow[]) ?? []);
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
  }, [brewId, firstDataDate, lastDataDate, isTvMode]);

  const chartData = useMemo(() => {
    let basePoints;

    if (snapshotRows.length > 0) {
      basePoints = snapshotRows.map((row) => {
        const useController = pillCompensation && row.controller_temp != null;
        const avgTemp =
          useController && row.pill_temp != null
            ? (row.controller_temp! + row.pill_temp) / 2
            : null;
        const tempSpan =
          useController && row.pill_temp != null
            ? Math.abs(row.pill_temp - row.controller_temp!)
            : null;
        return {
          date: row.recorded_at,
          value: row.sg,
          temp: row.pill_temp,
          pillTemp: row.pill_temp,
          controllerTemp: useController ? row.controller_temp : null,
          targetTemp: row.profile_target_temp,
          avgTemp,
          tempSpan,
        };
      });
    } else if (data && data.length > 0) {
      basePoints = data.map((point) => ({
        ...point,
        pillTemp: point.temp,
        controllerTemp: null as number | null,
        targetTemp: null as number | null,
        avgTemp: null as number | null,
        tempSpan: null as number | null,
      }));
    } else {
      return [];
    }

    // Apply smoothing for visual presentation (raw values preserved for tooltips)
    const windowSize = getOptimalWindowSize(basePoints.length);
    const smoothed = calculateMovingAverage(basePoints, windowSize, smoothLines);
    return addTimestamps(smoothed);
  }, [data, snapshotRows, smoothLines, pillCompensation]);

  const dayBoundaries = useMemo(() => generateDayBoundaries(chartData), [chartData]);
  const dayTicks = useMemo(() => generateDayTicks(chartData), [chartData]);

  return { chartData, dayBoundaries, dayTicks, isLoading };
}

