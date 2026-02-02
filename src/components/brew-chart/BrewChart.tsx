import { useState, useMemo, memo } from "react";
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
import { BrewChartProps } from "./types";
import { getEventDisplay, getEventsPerDay, formatXAxisTick, formatTooltipLabel } from "./utils";
import { useDeferredRender } from "@/hooks/use-deferred-render";
import { Skeleton } from "@/components/ui/skeleton";
import { useBrewChartData } from "./hooks/useBrewChartData";
import {
  CHART_MARGINS,
  COLORS,
  GRID_CONFIG,
  DAY_BOUNDARY_CONFIG,
  EVENT_MARKER_CONFIG,
  DATA_SERIES_CONFIG,
  AXIS_STYLES,
} from "./chartConfig";

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

          {/* Day change markers - must be direct children */}
          {dayBoundaries.map((timestamp, idx) => (
            <ReferenceLine
              key={`day-${idx}`}
              x={timestamp}
              yAxisId="sg"
              stroke={COLORS.mutedForeground}
              strokeDasharray={DAY_BOUNDARY_CONFIG.strokeDasharray}
              strokeOpacity={DAY_BOUNDARY_CONFIG.strokeOpacity}
              strokeWidth={DAY_BOUNDARY_CONFIG.strokeWidth}
            />
          ))}

          {/* Event markers - must be direct children */}
          {sortedEvents.map((event) => {
            const eventDisplay = getEventDisplay(event.event_type);
            return (
              <ReferenceLine
                key={event.id}
                x={event.timestamp}
                yAxisId="sg"
                stroke={eventDisplay.color}
                strokeWidth={EVENT_MARKER_CONFIG.strokeWidth}
                label={{
                  value: eventDisplay.label,
                  position: EVENT_MARKER_CONFIG.labelConfig.position,
                  fill: eventDisplay.color,
                  fontSize: EVENT_MARKER_CONFIG.labelConfig.fontSize,
                  fontWeight: EVENT_MARKER_CONFIG.labelConfig.fontWeight,
                  angle: EVENT_MARKER_CONFIG.labelConfig.angle,
                  offset: EVENT_MARKER_CONFIG.labelConfig.offset,
                }}
              />
            );
          })}

          {/* X-Axis */}
          <XAxis
            dataKey="timestamp"
            type="number"
            domain={["dataMin", "dataMax"]}
            stroke={COLORS.mutedForeground}
            style={{ fontSize: AXIS_STYLES.fontSize.x }}
            tick={{ fill: COLORS.mutedForeground }}
            ticks={dayTicks}
            tickFormatter={formatXAxisTick}
          />

          {/* Left Y-axis for SG */}
          <YAxis
            yAxisId="sg"
            domain={[fg - 0.001, og + 0.001]}
            stroke={COLORS.sg}
            style={{ fontSize: AXIS_STYLES.fontSize.y }}
            tick={{ fill: COLORS.sg }}
            tickFormatter={(value) => value.toFixed(3)}
          />

          {/* Right Y-axis for Temperature */}
          <YAxis
            yAxisId="temp"
            orientation="right"
            domain={["dataMin - 0.5", "dataMax + 0.5"]}
            stroke={COLORS.temp}
            style={{ fontSize: AXIS_STYLES.fontSize.y }}
            tick={{ fill: COLORS.temp }}
            tickFormatter={(value) => `${value.toFixed(1)}°C`}
          />

          {/* Tooltip */}
          <Tooltip
            contentStyle={{
              backgroundColor: COLORS.card,
              border: "none",
              borderRadius: "8px",
              color: COLORS.foreground,
              lineHeight: "1",
              padding: "6px 8px",
            }}
            labelStyle={{ color: COLORS.mutedForeground, marginBottom: "1px" }}
            itemStyle={{ lineHeight: "1.1", padding: "1px 0" }}
            labelFormatter={formatTooltipLabel}
            formatter={(value: number, name: string) => {
              if (name === "value") return [value.toFixed(3), "SG"];
              if (name === "controllerTemp")
                return [
                  <span key="v" style={{ color: COLORS.temp }}>{value.toFixed(1)}°C</span>,
                  <span key="l" style={{ color: COLORS.temp }}>Controller</span>,
                ];
              if (name === "targetTemp")
                return [
                  <span key="v" style={{ color: COLORS.targetTemp }}>{value.toFixed(1)}°C</span>,
                  <span key="l" style={{ color: COLORS.targetTemp }}>Mål</span>,
                ];
              if (name === "pillTemp")
                return [
                  <span key="v" style={{ color: "hsl(var(--temp-blue) / 0.5)" }}>{value.toFixed(1)}°C</span>,
                  <span key="l" style={{ color: "hsl(var(--temp-blue) / 0.5)" }}>Pill</span>,
                ];
              return [value, name];
            }}
          />

          {/* SG Line */}
          <Line
            yAxisId="sg"
            type={lineType}
            dataKey="value"
            stroke={COLORS.sg}
            strokeWidth={DATA_SERIES_CONFIG.sg.strokeWidth}
            dot={false}
            activeDot={{ r: DATA_SERIES_CONFIG.sg.dotRadius, fill: COLORS.sg }}
            name="value"
            isAnimationActive={isAnimationActive}
            style={{ filter: DATA_SERIES_CONFIG.sg.filter }}
          />

          {/* Controller temp - main temperature with subtle background */}
          <Area
            yAxisId="temp"
            type={areaType}
            dataKey="controllerTemp"
            stroke={COLORS.temp}
            strokeWidth={DATA_SERIES_CONFIG.controllerTemp.strokeWidth}
            fill={COLORS.tempFill}
            dot={false}
            activeDot={{ r: DATA_SERIES_CONFIG.controllerTemp.dotRadius, fill: COLORS.temp }}
            name="controllerTemp"
            isAnimationActive={isAnimationActive}
            connectNulls={false}
          />

          {/* Pill temp - faint secondary line */}
          <Line
            yAxisId="temp"
            type={areaType}
            dataKey="pillTemp"
            stroke={COLORS.tempFaint}
            strokeWidth={DATA_SERIES_CONFIG.pillTemp.strokeWidth}
            dot={false}
            activeDot={{ r: DATA_SERIES_CONFIG.pillTemp.dotRadius, fill: "hsl(var(--temp-blue) / 0.5)" }}
            name="pillTemp"
            isAnimationActive={isAnimationActive}
          />

          {/* Target temp - dashed line showing setpoint */}
          <Line
            yAxisId="temp"
            type="stepAfter"
            dataKey="targetTemp"
            stroke={COLORS.targetTemp}
            strokeWidth={DATA_SERIES_CONFIG.targetTemp.strokeWidth}
            strokeDasharray={DATA_SERIES_CONFIG.targetTemp.strokeDasharray}
            dot={false}
            activeDot={{ r: DATA_SERIES_CONFIG.targetTemp.dotRadius, fill: COLORS.targetTemp }}
            name="targetTemp"
            isAnimationActive={isAnimationActive}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export const BrewChart = memo(BrewChartComponent);
