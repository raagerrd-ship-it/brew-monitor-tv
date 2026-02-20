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
import { BrewChartProps } from "./types";
import { getEventDisplay, getEventsPerDay, formatXAxisTick, formatTooltipLabel } from "./utils";
import { useStaggeredRender } from "@/hooks/use-deferred-render";
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
  chartIndex = 0,
  smoothLines: externalSmoothLines,
  onSmoothLinesChange,
}: BrewChartProps) {
  const [internalSmoothLines, setInternalSmoothLines] = useState(true);
  const smoothLines = externalSmoothLines ?? internalSmoothLines;
  const setSmoothLines = onSmoothLinesChange ?? setInternalSmoothLines;
  const { isTvMode } = useTvMode();

  // Defer chart rendering using staggered approach
  const shouldRenderChart = useStaggeredRender(chartIndex);

  const { chartData, dayBoundaries, dayTicks } = useBrewChartData({
    data: shouldRenderChart ? data : [],
    controllerId: shouldRenderChart ? controllerId : undefined,
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
  // Disable all animations - data loads in background and chart appears when ready
  const isAnimationActive = false;

  return (
    <div className="h-full relative group">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={CHART_MARGINS}>
          <defs>
            <linearGradient id={`avgTempGrad-${chartIndex}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--temp-blue))" stopOpacity={0.15} />
              <stop offset="100%" stopColor="hsl(var(--temp-blue))" stopOpacity={0} />
            </linearGradient>
            <linearGradient id={`tempSpanGrad-${chartIndex}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--temp-blue))" stopOpacity={0.15} />
              <stop offset="100%" stopColor="hsl(var(--temp-blue))" stopOpacity={0.08} />
            </linearGradient>
          </defs>
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
              formatter={(value: number, name: string, payload: any) => {
                // Use raw (unsmoothed) values for tooltip display
                const rawPayload = payload?.payload;
                
                if (name === "value") {
                  const displayValue = rawPayload?.rawValue ?? value;
                  return [displayValue.toFixed(3), "SG"];
                }
                if (name === "avgTemp") {
                  const displayValue = rawPayload?.rawAvgTemp ?? value;
                  return [
                    <span key="v" style={{ color: COLORS.temp }}>{displayValue.toFixed(1)}°C</span>,
                    <span key="l" style={{ color: COLORS.temp }}>Snitt:</span>,
                  ];
                }
                if (name === "controllerTemp") {
                  const displayValue = rawPayload?.rawControllerTemp ?? value;
                  return [
                    <span key="v" style={{ color: COLORS.tempFaint }}>{displayValue.toFixed(1)}°C</span>,
                    <span key="l" style={{ color: COLORS.tempFaint }}>Probe:</span>,
                  ];
                }
                if (name === "targetTemp")
                  return [
                    <span key="v" style={{ color: COLORS.targetTemp }}>{value.toFixed(1)}°C</span>,
                    <span key="l" style={{ color: COLORS.targetTemp }}>Mål:</span>,
                  ];
                if (name === "pillTemp") {
                  const displayValue = rawPayload?.rawPillTemp ?? value;
                  return [
                    <span key="v" style={{ color: COLORS.tempFaint }}>{displayValue.toFixed(1)}°C</span>,
                    <span key="l" style={{ color: COLORS.tempFaint }}>Pill:</span>,
                  ];
                }
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

          {/* Average temp - main temperature with gradient that fades downward */}
          <Area
            yAxisId="temp"
            type={areaType}
            dataKey="avgTemp"
            stroke={COLORS.temp}
            strokeWidth={DATA_SERIES_CONFIG.avgTemp.strokeWidth}
            fill={`url(#avgTempGrad-${chartIndex})`}
            dot={false}
            activeDot={{ r: DATA_SERIES_CONFIG.avgTemp.dotRadius, fill: COLORS.temp }}
            name="avgTemp"
            isAnimationActive={isAnimationActive}
            connectNulls={false}
          />

          {/* Stacked areas: controller as invisible base + tempSpan as colored band between pill & controller */}
          <Area
            yAxisId="temp"
            type={areaType}
            dataKey="controllerTemp"
            stackId="tempSpan"
            stroke={COLORS.tempFaint}
            strokeWidth={DATA_SERIES_CONFIG.controllerTemp.strokeWidth}
            fill="transparent"
            dot={false}
            activeDot={{ r: DATA_SERIES_CONFIG.controllerTemp.dotRadius, fill: "hsl(var(--temp-blue) / 0.5)" }}
            name="controllerTemp"
            isAnimationActive={isAnimationActive}
            connectNulls={false}
          />
          <Area
            yAxisId="temp"
            type={areaType}
            dataKey="tempSpan"
            stackId="tempSpan"
            stroke="none"
            strokeWidth={0}
            fill={`url(#tempSpanGrad-${chartIndex})`}
            dot={false}
            activeDot={false}
            name="tempSpan"
            isAnimationActive={isAnimationActive}
            connectNulls={false}
            tooltipType="none"
          />

          {/* Pill temp line on top */}
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
            type="linear"
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
