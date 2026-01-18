import { useState, useEffect, useMemo, memo } from "react";
import { useTvMode } from "@/contexts/TvModeContext";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import { Button } from "../ui/button";
import { TrendingUp } from "lucide-react";
import { BrewChartProps, ControllerTempPoint } from "./types";
import {
  calculateMovingAverage,
  addTimestamps,
  generateDayBoundaries,
  generateDayTicks,
  getEventDisplay,
  getEventsPerDay,
  formatXAxisTick,
  formatTooltipLabel,
  getOptimalWindowSize,
  mergeWithControllerTemp,
  downsampleForTvMode,
} from "./utils";
import { supabase } from "@/integrations/supabase/client";
import { useDeferredRender } from "@/hooks/use-deferred-render";
import { Skeleton } from "@/components/ui/skeleton";

function BrewChartComponent({ data, og, fg, singleView = false, events = [], controllerId }: BrewChartProps) {
  const [smoothLines, setSmoothLines] = useState(true);
  const [controllerTempData, setControllerTempData] = useState<ControllerTempPoint[]>([]);
  const { isTvMode } = useTvMode();
  
  // Defer chart rendering to prevent blocking main thread during page updates
  const shouldRenderChart = useDeferredRender();
  
  // Fetch controller temperature history when controllerId is provided
  // In TV mode, refresh every 60 seconds instead of only once
  useEffect(() => {
    if (!controllerId || !data || data.length === 0) {
      setControllerTempData([]);
      return;
    }

    const fetchControllerTemp = async () => {
      // Get the time range from sg_data
      const sortedData = [...data].sort((a, b) => 
        new Date(a.date).getTime() - new Date(b.date).getTime()
      );
      const startTime = sortedData[0].date;
      const endTime = sortedData[sortedData.length - 1].date;

      const { data: tempHistory, error } = await supabase.rpc('get_temp_history_sampled', {
        p_controller_id: controllerId,
        p_start_time: startTime,
        p_end_time: endTime,
        p_sample_interval_minutes: 15 // Sample every 15 minutes for chart
      });

      if (error) {
        console.error('Error fetching controller temp history:', error);
        return;
      }

      if (tempHistory && tempHistory.length > 0) {
        setControllerTempData(tempHistory);
      }
    };

    fetchControllerTemp();
    
    // In TV mode, refresh controller temp data every 60 seconds
    // (since realtime subscriptions are disabled)
    if (isTvMode) {
      const intervalId = setInterval(fetchControllerTemp, 60000);
      return () => clearInterval(intervalId);
    }
  }, [controllerId, data, isTvMode]);
  
  // Memoize all expensive calculations
  // In TV mode, downsample to max 80 points to reduce rendering load
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];
    
    // Downsample early in TV mode to reduce all subsequent calculations
    const sourceData = isTvMode ? downsampleForTvMode(data, 80) : data;
    const controllerDataSampled = isTvMode ? downsampleForTvMode(controllerTempData, 80) : controllerTempData;
    
    const dataWithControllerTemp = mergeWithControllerTemp(sourceData, controllerDataSampled);
    const windowSize = getOptimalWindowSize(dataWithControllerTemp.length);
    const smoothedData = calculateMovingAverage(dataWithControllerTemp, windowSize, smoothLines);
    return addTimestamps(smoothedData);
  }, [data, controllerTempData, smoothLines, isTvMode]);

  const dayBoundaries = useMemo(() => 
    generateDayBoundaries(chartData), 
    [chartData]
  );

  const dayTicks = useMemo(() => 
    generateDayTicks(chartData), 
    [chartData]
  );

  const sortedEvents = useMemo(() => 
    getEventsPerDay(events), 
    [events]
  );

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
        <ComposedChart data={chartData} margin={{ top: 20, right: -10, left: -20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
          
          {/* Day change markers */}
          {dayBoundaries.map((timestamp, idx) => (
            <ReferenceLine
              key={`day-${idx}`}
              x={timestamp}
              yAxisId="sg"
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="2 4"
              strokeOpacity={0.25}
              strokeWidth={1}
            />
          ))}
          
          {/* Event markers */}
          {sortedEvents.map((event) => {
            const eventDisplay = getEventDisplay(event.event_type);
            
            return (
              <ReferenceLine
                key={event.id}
                x={event.timestamp}
                yAxisId="sg"
                stroke={eventDisplay.color}
                strokeWidth={3}
                label={{
                  value: eventDisplay.label,
                  position: 'insideTopRight',
                  fill: eventDisplay.color,
                  fontSize: 14,
                  fontWeight: 'bold',
                  angle: -90,
                  offset: 0
                }}
              />
            );
          })}
          
          <XAxis
            dataKey="timestamp"
            type="number"
            domain={['dataMin', 'dataMax']}
            stroke="hsl(var(--muted-foreground))"
            style={{ fontSize: "9px" }}
            tick={{ fill: "hsl(var(--muted-foreground))" }}
            ticks={dayTicks}
            tickFormatter={formatXAxisTick}
          />
          
          {/* Left Y-axis for SG */}
          <YAxis
            yAxisId="sg"
            domain={[fg - 0.001, og + 0.001]}
            stroke="hsl(var(--beer-amber))"
            style={{ fontSize: "10px" }}
            tick={{ fill: "hsl(var(--beer-amber))" }}
            tickFormatter={(value) => value.toFixed(3)}
          />
          
          {/* Right Y-axis for Temperature */}
          <YAxis
            yAxisId="temp"
            orientation="right"
            domain={['dataMin - 0.5', 'dataMax + 0.5']}
            stroke="hsl(var(--temp-blue))"
            style={{ fontSize: "10px" }}
            tick={{ fill: "hsl(var(--temp-blue))" }}
            tickFormatter={(value) => `${value.toFixed(1)}°C`}
          />
          
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "none",
              borderRadius: "8px",
              color: "hsl(var(--foreground))",
              lineHeight: "1",
              padding: "6px 8px",
            }}
            labelStyle={{ color: "hsl(var(--muted-foreground))", marginBottom: "1px" }}
            itemStyle={{ lineHeight: "1.1", padding: "1px 0" }}
            labelFormatter={formatTooltipLabel}
            formatter={(value: number, name: string) => {
              if (name === "value") return [value.toFixed(3), "SG"];
              if (name === "controllerTemp") return [
                <span style={{ color: "hsl(var(--temp-blue))" }}>{value.toFixed(1)}°C</span>,
                <span style={{ color: "hsl(var(--temp-blue))" }}>Controller</span>
              ];
              if (name === "pillTemp") return [
                <span style={{ color: "hsl(var(--temp-blue) / 0.5)" }}>{value.toFixed(1)}°C</span>,
                <span style={{ color: "hsl(var(--temp-blue) / 0.5)" }}>Pill</span>
              ];
              return [value, name];
            }}
          />
          
          <Line
            yAxisId="sg"
            type={lineType}
            dataKey="value"
            stroke="hsl(var(--beer-amber))"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 5, fill: "hsl(var(--beer-amber))" }}
            name="value"
            isAnimationActive={!isTvMode}
            style={{
              filter: "drop-shadow(0 0 6px hsl(var(--beer-amber) / 0.6))"
            }}
          />
          
          {/* Controller temp - main temperature line */}
          <Line
            yAxisId="temp"
            type={areaType}
            dataKey="controllerTemp"
            stroke="hsl(var(--temp-blue))"
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 4, fill: "hsl(var(--temp-blue))" }}
            name="controllerTemp"
            isAnimationActive={!isTvMode}
            connectNulls={false}
          />
          
          {/* Pill temp - faint secondary line */}
          <Line
            yAxisId="temp"
            type={areaType}
            dataKey="pillTemp"
            stroke="hsl(var(--temp-blue) / 0.3)"
            strokeWidth={1}
            dot={false}
            activeDot={{ r: 3, fill: "hsl(var(--temp-blue) / 0.5)" }}
            name="pillTemp"
            isAnimationActive={!isTvMode}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export const BrewChart = memo(BrewChartComponent);
