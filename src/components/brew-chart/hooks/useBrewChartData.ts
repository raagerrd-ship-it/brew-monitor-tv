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

  const fullKey = useRef<string>("");
  const lastRecordedAt = useRef<string | null>(null);
  // Diagrammet börjar 1 timme före pitch (fermentation_start) om värden finns.
  const chartCutoff = useRef<number | null>(null);
  const lastFullFetchAt = useRef(0);
  const rowCount = useRef(0);

  useEffect(() => {
    if (!brewId) {
      setSnapshotRows((prev) => (prev.length > 0 ? [] : prev));
      return;
    }

    const fetchKey = `${brewId}-${firstDataDate}-${lastDataDate}`;
    if (fetchKey === lastFetchKey.current) return;

    const fetchData = async () => {
      lastFetchKey.current = fetchKey;
      // Full hämtning bara första gången eller vid byte av bryggning/tidsintervall
      const key = `${brewId}-${timeRange}`;
      // Full hämtning (serverns ~500-raders gallring) var 6:e timme eller när raderna växt över 2× taket
      const incremental = fullKey.current === key && lastRecordedAt.current != null
        && Date.now() - lastFullFetchAt.current < 6 * 60 * 60 * 1000 && rowCount.current <= 1000;
      if (!incremental) setIsLoading(true);
      try {
        if (!incremental) {
          const { data: brewRow } = await supabase
            .from("brew_readings")
            .select("fermentation_start")
            .eq("id", brewId)
            .single();
          chartCutoff.current = brewRow?.fermentation_start
            ? new Date(brewRow.fermentation_start).getTime() - 60 * 60 * 1000
            : null;
        }
        // Thinning policy caps snapshots at ~500 per brew, no pagination needed
        let q = supabase
          .from("brew_data_snapshots")
          .select("recorded_at, sg, pill_temp, controller_temp, profile_target_temp, actual_temp")
          .eq("brew_id", brewId);
        if (incremental) q = q.gt("recorded_at", lastRecordedAt.current!);
        const { data: batch, error } = await q.order("recorded_at", { ascending: true });

        if (error) {
          console.error("[useBrewChartData] Failed to fetch snapshots:", error);
          return;
        }

        const cutoff = chartCutoff.current;
        const rows = ((batch as SnapshotRow[]) ?? []).filter(
          (r) => cutoff == null || new Date(r.recorded_at).getTime() >= cutoff
        );
        if (incremental) {
          if (rows.length === 0) return;
          rowCount.current += rows.length;
          setSnapshotRows((prev) => [...prev, ...rows]);
        } else {
          fullKey.current = key;
          lastFullFetchAt.current = Date.now();
          rowCount.current = rows.length;
          setSnapshotRows(rows);
        }
        if (rows.length > 0) lastRecordedAt.current = rows[rows.length - 1].recorded_at;
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [brewId, firstDataDate, lastDataDate, timeRange]);

  // Bero bara på den datakälla som faktiskt ritas
  const hasSnapshots = snapshotRows.length > 0;
  const fallbackData = hasSnapshots ? null : data;
  const chartData = useMemo(() => {
    const data = fallbackData;
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
    const withTs = addTimestamps(smoothed);
    return isTvMode ? downsampleForTvMode(withTs, 150) : withTs;
  }, [fallbackData, snapshotRows, smoothLines, timeRange, isTvMode]);

  const dayBoundaries = useMemo(() => generateDayBoundaries(chartData), [chartData]);
  const dayTicks = useMemo(() => generateDayTicks(chartData), [chartData]);

  return { chartData, dayBoundaries, dayTicks, isLoading };
}

