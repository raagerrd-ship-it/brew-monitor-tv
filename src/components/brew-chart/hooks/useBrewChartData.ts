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
  timeRange?: '12h' | 'full';
  /** @deprecated ignored — dual sensor is per-controller now */
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
  actual_temp: number | null;
}

export function useBrewChartData({
  data,
  controllerId: _controllerId,
  brewId,
  smoothLines,
  timeRange = 'full',
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
          .select("recorded_at, sg, pill_temp, controller_temp, profile_target_temp, actual_temp")
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
      const r1 = (v: number | null) => v != null ? Math.round(v * 10) / 10 : null;
      basePoints = snapshotRows.map((row) => {
        // SSOT: actual_temp is the main line, pill & controller always secondary
        const actualTemp = r1(row.actual_temp ?? row.pill_temp ?? row.controller_temp ?? null);
        const pillTemp = r1(row.pill_temp);
        const controllerTemp = r1(row.controller_temp);
        const hasBoth = controllerTemp != null && pillTemp != null;
        const tempSpan = hasBoth
          ? Math.abs(pillTemp! - controllerTemp!)
          : null;
        return {
          date: row.recorded_at,
          value: row.sg,
          temp: actualTemp,
          pillTemp,
          controllerTemp,
          targetTemp: r1(row.profile_target_temp),
          avgTemp: actualTemp,
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

    // Apply time range filter
    if (timeRange === '12h' && basePoints.length > 0) {
      const cutoff = Date.now() - 12 * 60 * 60 * 1000;
      const filtered = basePoints.filter(p => new Date(p.date).getTime() >= cutoff);
      if (filtered.length > 0) basePoints = filtered;
    }

    // SG-only median filter (5-pt window) to suppress per-bucket Pill BLE jitter
    // without touching temperatures or 5-min bucket cadence.
    if (basePoints.length >= 3) {
      const W = 5;
      const half = Math.floor(W / 2);
      const smoothedSg = basePoints.map((_, i) => {
        const slice: number[] = [];
        for (let j = Math.max(0, i - half); j <= Math.min(basePoints.length - 1, i + half); j++) {
          const v = basePoints[j].value;
          if (v != null && !isNaN(v)) slice.push(v);
        }
        if (slice.length === 0) return basePoints[i].value;
        slice.sort((a, b) => a - b);
        const mid = Math.floor(slice.length / 2);
        return slice.length % 2 === 0 ? (slice[mid - 1] + slice[mid]) / 2 : slice[mid];
      });
      basePoints = basePoints.map((p, i) => ({ ...p, value: smoothedSg[i] }));
    }

    // Apply smoothing for visual presentation (raw values preserved for tooltips)
    const windowSize = getOptimalWindowSize(basePoints.length);
    const smoothed = calculateMovingAverage(basePoints, windowSize, smoothLines);
    return addTimestamps(smoothed);
  }, [data, snapshotRows, smoothLines, timeRange]);

  const dayBoundaries = useMemo(() => generateDayBoundaries(chartData), [chartData]);
  const dayTicks = useMemo(() => generateDayTicks(chartData), [chartData]);

  return { chartData, dayBoundaries, dayTicks, isLoading };
}

