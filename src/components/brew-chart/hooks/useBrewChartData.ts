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
  smoothLines: boolean;
}

interface UseBrewChartDataReturn {
  chartData: ChartDataPointWithTimestamp[];
  dayBoundaries: number[];
  dayTicks: number[];
  isLoading: boolean;
}

export function useBrewChartData({
  data,
  controllerId,
  smoothLines,
}: UseBrewChartDataProps): UseBrewChartDataReturn {
  const [controllerTempData, setControllerTempData] = useState<ControllerTempPoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
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
      return;
    }

    // Create a key to detect if we need to refetch
    const fetchKey = `${controllerId}-${firstDataDate}-${lastDataDate}`;
    if (fetchKey === lastFetchKey.current) {
      return; // Already fetched this data
    }

    const fetchControllerTemp = async () => {
      lastFetchKey.current = fetchKey;
      setIsLoading(true);
      try {
        const { data: tempHistory, error } = await supabase.rpc("get_temp_history_sampled", {
          p_controller_id: controllerId,
          p_start_time: firstDataDate,
          p_end_time: lastDataDate,
          p_sample_interval_minutes: 15,
        });

        if (error) {
          console.error("Error fetching controller temp history:", error);
          return;
        }

        if (tempHistory && tempHistory.length > 0) {
          setControllerTempData(tempHistory);
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
  }, [controllerId, dataLength, firstDataDate, lastDataDate, isTvMode]);

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
    return addTimestamps(smoothedData);
  }, [data, controllerTempData, smoothLines, isTvMode]);

  const dayBoundaries = useMemo(() => generateDayBoundaries(chartData), [chartData]);

  const dayTicks = useMemo(() => generateDayTicks(chartData), [chartData]);

  return {
    chartData,
    dayBoundaries,
    dayTicks,
    isLoading,
  };
}
