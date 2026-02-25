import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTvMode } from "@/contexts/TvModeContext";
import { ChartDataPointWithTimestamp } from "../types";
import {
  addTimestamps,
  generateDayBoundaries,
  generateDayTicks,
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
  smoothLines: _smoothLines,
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
        const allSnapshots: SnapshotRow[] = [];
        let offset = 0;
        const batchSize = 1000;
        let hasMore = true;

        while (hasMore) {
          const { data: batch, error } = await supabase
            .from("brew_data_snapshots")
            .select("recorded_at, sg, pill_temp, controller_temp, profile_target_temp")
            .eq("brew_id", brewId)
            .order("recorded_at", { ascending: true })
            .range(offset, offset + batchSize - 1);

          if (error) {
            console.error("[useBrewChartData] Failed to fetch snapshots:", error);
            hasMore = false;
          } else if (!batch || batch.length === 0) {
            hasMore = false;
          } else {
            allSnapshots.push(...(batch as SnapshotRow[]));
            offset += batchSize;
            hasMore = batch.length === batchSize;
          }
        }

        setSnapshotRows(allSnapshots);
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
    if (snapshotRows.length > 0) {
      return addTimestamps(
        snapshotRows.map((row) => ({
          date: row.recorded_at,
          value: row.sg,
          temp: row.pill_temp,
          pillTemp: row.pill_temp,
          controllerTemp: row.controller_temp,
          targetTemp: row.profile_target_temp,
          avgTemp: null,
          tempSpan: null,
          rawValue: row.sg,
          rawPillTemp: row.pill_temp,
          rawControllerTemp: row.controller_temp,
          rawAvgTemp: null,
        }))
      );
    }

    if (!data || data.length === 0) return [];

    return addTimestamps(
      data.map((point) => ({
        ...point,
        pillTemp: point.temp,
        controllerTemp: null,
        targetTemp: null,
        avgTemp: null,
        tempSpan: null,
        rawValue: point.value,
        rawPillTemp: point.temp,
        rawControllerTemp: null,
        rawAvgTemp: null,
      }))
    );
  }, [data, snapshotRows]);

  const dayBoundaries = useMemo(() => generateDayBoundaries(chartData), [chartData]);
  const dayTicks = useMemo(() => generateDayTicks(chartData), [chartData]);

  return { chartData, dayBoundaries, dayTicks, isLoading };
}

