import { useState, useMemo, memo } from "react";
import { useTvMode } from "@/contexts/TvModeContext";
import { CartesianGrid, ComposedChart, ResponsiveContainer } from "recharts";
import { Button } from "../ui/button";
import { TrendingUp } from "lucide-react";
import { BrewChartProps } from "./types";
import { getEventsPerDay } from "./utils";
import { useDeferredRender } from "@/hooks/use-deferred-render";
import { Skeleton } from "@/components/ui/skeleton";
import { useBrewChartData } from "./hooks/useBrewChartData";
import { CHART_MARGINS, COLORS, GRID_CONFIG } from "./chartConfig";
import { DayBoundaryLines, EventMarkerLines } from "./ChartReferenceLines";
import { ChartXAxis, SGYAxis, TempYAxis } from "./ChartAxes";
import { SGLine, ControllerTempArea, PillTempLine } from "./ChartDataSeries";
import { ChartTooltip } from "./ChartTooltipContent";

function BrewChartComponent({
  data,
  og,
  fg,
  singleView = false,
  events = [],
  controllerId,
}: BrewChartProps) {
  const [smoothLines, setSmoothLines] = useState(true);
  const { isTvMode } = useTvMode();

  // Defer chart rendering to prevent blocking main thread during page updates
  const shouldRenderChart = useDeferredRender();

  // Custom hook for data fetching and processing
  const { chartData, dayBoundaries, dayTicks } = useBrewChartData({
    data,
    controllerId,
    smoothLines,
  });

  // Memoize sorted events
  const sortedEvents = useMemo(() => getEventsPerDay(events), [events]);

  // Check if data is empty or has no values
  if (!data || data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-muted-foreground text-lg">N/A</p>
      </div>
    );
  }

  // Show skeleton while deferring render to prevent blocking main thread
  if (!shouldRenderChart) {
    return (
      <div className="h-full flex items-center justify-center">
        <Skeleton className="w-full h-full rounded-lg" />
      </div>
    );
  }

  const lineType = smoothLines ? "monotoneX" : "linear";
  const areaType = smoothLines ? "monotoneX" : "linear";
  const isAnimationActive = !isTvMode;

  return (
    <div className="h-full relative group">
      {!isTvMode && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 left-10 z-10 h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          onClick={() => setSmoothLines(!smoothLines)}
          title={smoothLines ? "Visa raka linjer" : "Visa utjämnade linjer"}
        >
          <TrendingUp className={smoothLines ? "text-primary" : "text-muted-foreground"} />
        </Button>
      )}
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={CHART_MARGINS}>
          <CartesianGrid
            strokeDasharray={GRID_CONFIG.strokeDasharray}
            stroke={COLORS.border}
            opacity={GRID_CONFIG.opacity}
          />

          {/* Day change markers */}
          <DayBoundaryLines dayBoundaries={dayBoundaries} />

          {/* Event markers */}
          <EventMarkerLines events={sortedEvents} />

          {/* Axes */}
          <ChartXAxis dayTicks={dayTicks} />
          <SGYAxis og={og} fg={fg} />
          <TempYAxis />

          {/* Tooltip */}
          <ChartTooltip />

          {/* Data series */}
          <SGLine lineType={lineType} isAnimationActive={isAnimationActive} />
          <ControllerTempArea areaType={areaType} isAnimationActive={isAnimationActive} />
          <PillTempLine lineType={lineType} isAnimationActive={isAnimationActive} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export const BrewChart = memo(BrewChartComponent);
