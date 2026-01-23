import { useState, useEffect, useMemo } from "react";
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

  // Fetch controller temperature history when controllerId is provided
  useEffect(() => {
    if (!controllerId || !data || data.length === 0) {
      setControllerTempData([]);
      return;
    }

    const fetchControllerTemp = async () => {
      setIsLoading(true);
      try {
        // Get the time range from sg_data
        const sortedData = [...data].sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
        );
        const startTime = sortedData[0].date;
        const endTime = sortedData[sortedData.length - 1].date;

        const { data: tempHistory, error } = await supabase.rpc("get_temp_history_sampled", {
          p_controller_id: controllerId,
          p_start_time: startTime,
          p_end_time: endTime,
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

    // In TV mode, refresh controller temp data every 60 seconds
    if (isTvMode) {
      const intervalId = setInterval(fetchControllerTemp, 60000);
      return () => clearInterval(intervalId);
    }
  }, [controllerId, data, isTvMode]);

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
