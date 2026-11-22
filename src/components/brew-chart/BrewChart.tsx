import { useState, useMemo, memo, useRef } from "react";
import { useTvEventAnimation } from "@/hooks/use-tv-event-animation";
import { useTvMode } from "@/contexts/TvModeContext";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Customized,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import { BrewChartProps } from "./types";
import { getEventDisplay, getEventsPerDay, getEventLabelLanes, getEventStripHeight, formatXAxisTick, formatTooltipLabel } from "./utils";
import { useStaggeredRender } from "@/hooks/use-deferred-render";
import { Skeleton } from "@/components/ui/skeleton";
import { useBrewChartData } from "./hooks/useBrewChartData";
import {
  CHART_MARGINS,
  COLORS,
  GRID_CONFIG,
  DAY_BOUNDARY_CONFIG,
  DATA_SERIES_CONFIG,
  AXIS_STYLES,
} from "./chartConfig";

function PointPing({ timestamp, x, y, color, enabled }: { timestamp: number; x: number; y: number; color: string; enabled: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useTvEventAnimation(ref, timestamp, 'tv-ping-active', enabled);
  return <span ref={ref} aria-hidden="true" className="tv-point-ping pointer-events-none absolute rounded-full" style={{ left: x - 4, top: y - 4, width: 8, height: 8, background: color }} />;
}

function BrewChartComponent({
  data,
  og,
  fg,
  singleView = false,
  events = [],
  controllerId,
  chartIndex = 0,
  brewId,
  smoothLines: externalSmoothLines,
  onSmoothLinesChange,
  timeRange = 'full',
  onTimeRangeChange: _onTimeRangeChange,
  pillCompensation: _pillCompensation = true,
  brewStatus,
}: BrewChartProps) {
  const [internalSmoothLines, setInternalSmoothLines] = useState(true);
  const smoothLines = externalSmoothLines ?? internalSmoothLines;
  const setSmoothLines = onSmoothLinesChange ?? setInternalSmoothLines;
  const { isTvMode } = useTvMode();
  const [chartWidth, setChartWidth] = useState(0);
  // Live-ringarna ritas som HTML ovanpå diagrammet (GPU-komponerad transform/opacity i stället för SVG-omritning).
  const [rings, setRings] = useState<Record<string, { x: number; y: number; color: string }>>({});
  const ringRef = useRef(rings);
  const reportRing = (key: string, x: number, y: number, color: string) => {
    const prev = ringRef.current[key];
    if (prev && prev.x === x && prev.y === y) return;
    ringRef.current = { ...ringRef.current, [key]: { x, y, color } };
    queueMicrotask(() => setRings(ringRef.current));
  };

  // Defer chart rendering using staggered approach
  const shouldRenderChart = useStaggeredRender(chartIndex);

  const { chartData, dayBoundaries, dayTicks } = useBrewChartData({
    data: shouldRenderChart ? data : [],
    controllerId: shouldRenderChart ? controllerId : undefined,
    brewId,
    smoothLines,
    timeRange,
  });

  // Memoize sorted events (pitch marker handled separately as a bottom-edge dot)
  const sortedEvents = useMemo(() => getEventsPerDay(events.filter(event => event.event_type !== 'jast')), [events]);
  const pitchEvents = useMemo(() => getEventsPerDay(events.filter(event => event.event_type === 'jast')), [events]);
  const labelLanes = useMemo(() => {
    if (chartData.length === 0) return new Map<string, { left: number; width: number; row: number }>();
    return getEventLabelLanes([...sortedEvents, ...pitchEvents], chartData[0].timestamp, chartData[chartData.length - 1].timestamp, chartWidth - CHART_MARGINS.left - CHART_MARGINS.right - 120 - 8);
  }, [chartData, sortedEvents, pitchEvents, chartWidth]);

  const eventStripHeight = getEventStripHeight(labelLanes);

  // Compute explicit temp domain from actual values (stacked areas skew dataMax)
  const tempDomain = useMemo(() => {
    if (chartData.length === 0) return [0, 30];
    let min = Infinity;
    let max = -Infinity;
    for (const p of chartData) {
      if (p.pillTemp != null && isFinite(p.pillTemp)) { min = Math.min(min, p.pillTemp); max = Math.max(max, p.pillTemp); }
      if (p.controllerTemp != null && isFinite(p.controllerTemp)) { min = Math.min(min, p.controllerTemp); max = Math.max(max, p.controllerTemp); }
      if (p.avgTemp != null && isFinite(p.avgTemp)) { min = Math.min(min, p.avgTemp); max = Math.max(max, p.avgTemp); }
    }
    if (!isFinite(min)) return [0, 30];
    return [min - 1, max + 1];
  }, [chartData]);

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
  const isActiveBrew = brewStatus !== 'Konditionering' && brewStatus !== 'Klar' && !!brewStatus;
  const lastSgIndex = chartData.reduce((last, p, i) => p.value != null && Number.isFinite(p.value) ? i : last, -1);
  const lastTempIndex = chartData.reduce((last, p, i) => p.avgTemp != null && Number.isFinite(p.avgTemp) ? i : last, -1);
  const liveDot = (key: string, lastIndex: number, color: string) => ({ cx, cy, index }: { cx?: number; cy?: number; index?: number }) => {
    if (!(isActiveBrew && lastIndex >= 0 && index === lastIndex && Number.isFinite(cx) && Number.isFinite(cy))) return <g />;
    reportRing(key, cx!, cy!, color);
    return <circle cx={cx} cy={cy} r={4} fill={color} />;
  };
  const activeDot = <T,>(d: T) => (isTvMode ? false : d);
  const areaType = smoothLines ? "monotoneX" : "linear";
  // Disable all animations - data loads in background and chart appears when ready
  const isAnimationActive = false;

  // Final SVG layer: opaque pills above the plot, connected to the unchanged axis dots.
  const eventOverlay = ({ offset, xAxisMap }: {
    offset?: { left: number; top: number; height: number };
    xAxisMap?: Record<string, { scale: (timestamp: number) => number }>;
  }) => {
    const scale = xAxisMap?.['0']?.scale;
    if (!offset || !scale) return <g />;
    const positioned = [...sortedEvents, ...pitchEvents].flatMap(event => {
      const layout = labelLanes.get(event.id);
      if (!layout) return [];
      return [{ event, layout, display: getEventDisplay(event.event_type), lineX: scale(event.timestamp), x: offset.left + 4 + layout.left, y: offset.top - eventStripHeight + layout.row * 21 }];
    });
    return <g className="chart-event-overlay" pointerEvents="none">
      {positioned.map(({ event, layout, lineX, x, y, display }) => <polyline key={`guide-${event.id}`} className="chart-event-guide" points={`${Math.max(x + 9, Math.min(x + layout.width - 9, lineX))},${y + 18} ${lineX},${offset.top} ${lineX},${offset.top + offset.height}`} fill="none" stroke={display.color} strokeOpacity={0.35} strokeWidth={1} strokeDasharray="2 3" />)}
      {positioned.map(({ event, layout, x, y, display }) => <g key={event.id} className="chart-event-pill" data-event-id={event.id}>
        <rect x={x} y={y} width={layout.width} height={18} rx={9} fill={COLORS.card} />
        <rect x={x} y={y} width={layout.width} height={18} rx={9} fill={display.color} fillOpacity={0.15} stroke={display.color} strokeOpacity={0.4} strokeWidth={1} />
        <text x={x + layout.width / 2} y={y + 12} textAnchor="middle" fill={display.color} fontSize={10.5} fontWeight={600}>{display.label}</text>
      </g>)}
    </g>;
  };


  return (
    <div className="h-full relative group">
      <ResponsiveContainer width="100%" height="100%" onResize={(width) => setChartWidth(width)}>
        <ComposedChart data={chartData} margin={{ ...CHART_MARGINS, top: CHART_MARGINS.top + eventStripHeight }}>
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

          {/* Event markers - unchanged dots at the bottom edge */}
          {sortedEvents.map((event) => {
            const eventDisplay = getEventDisplay(event.event_type);
            return (
              <ReferenceDot
                key={event.id}
                x={event.timestamp}
                y={tempDomain[0]}
                yAxisId="temp"
                r={4}
                fill={eventDisplay.color}
                stroke="none"
              />
            );
          })}

          {/* Pitch marker - unchanged dot at the bottom edge */}
          {pitchEvents.map((event) => {
            const eventDisplay = getEventDisplay('jast');
            return (
              <ReferenceDot
                key={`pitch-${event.id}`}
                x={event.timestamp}
                y={tempDomain[0]}
                yAxisId="temp"
                r={4}
                fill={eventDisplay.color}
                stroke="none"
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
            domain={[Math.min(fg, ...chartData.filter(p => p.value != null).map(p => p.value)) - 0.001, og + 0.001]}
            stroke={COLORS.sg}
            style={{ fontSize: AXIS_STYLES.fontSize.y }}
            tick={{ fill: COLORS.sg }}
            tickFormatter={(value) => value.toFixed(3)}
          />

          {/* Right Y-axis for Temperature */}
          <YAxis
            yAxisId="temp"
            orientation="right"
            domain={tempDomain}
            allowDataOverflow={true}
            stroke={COLORS.temp}
            style={{ fontSize: AXIS_STYLES.fontSize.y }}
            tick={{ fill: COLORS.temp }}
            tickFormatter={(value) => `${value.toFixed(1)}°`}
          />

          {/* Tooltip */}
           {!isTvMode && <Tooltip
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
                 const rawPayload = payload?.payload;
                 if (name === "value") {
                   const dv = rawPayload?.rawValue ?? value;
                   return [<span key="v" style={{ color: COLORS.sg }}>SG (20 °C): {dv.toFixed(3)}</span>, null];
                 }
                 if (name === "avgTemp") {
                   const dv = rawPayload?.rawAvgTemp ?? value;
                    return [<span key="v" style={{ color: COLORS.temp }}>Snitt: {dv.toFixed(1)}°</span>, null];
                  }
                  if (name === "controllerTemp") {
                    const dv = rawPayload?.rawControllerTemp ?? value;
                    return [<span key="v" style={{ color: COLORS.tempFaint }}>Probe: {dv.toFixed(1)}°</span>, null];
                  }
                  if (name === "targetTemp")
                    return [<span key="v" style={{ color: COLORS.targetTemp }}>Mål: {value.toFixed(1)}°</span>, null];
                  if (name === "pillTemp") {
                    const dv = rawPayload?.rawPillTemp ?? value;
                    return [<span key="v" style={{ color: COLORS.tempFaint }}>Pill: {dv.toFixed(1)}°</span>, null];
                 }
                 return [value, name];
               }}
            />}

          {/* TV: bred halvgenomskinlig stroke som glöd i stället för drop-shadow-filter */}
          {isTvMode && (
            <Line
              yAxisId="sg"
              type={lineType}
              dataKey="value"
              stroke={COLORS.sg}
              strokeOpacity={0.25}
              strokeWidth={DATA_SERIES_CONFIG.sg.strokeWidth * 3}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
              tooltipType="none"
              legendType="none"
            />
          )}

          {/* SG Line */}
          <Line
            yAxisId="sg"
            type={lineType}
            dataKey="value"
            stroke={COLORS.sg}
            strokeWidth={DATA_SERIES_CONFIG.sg.strokeWidth}
            dot={isActiveBrew ? liveDot("sg", lastSgIndex, COLORS.sg) : false}
            activeDot={activeDot({ r: DATA_SERIES_CONFIG.sg.dotRadius, fill: COLORS.sg })}
            name="value"
            isAnimationActive={isAnimationActive}
            style={isTvMode ? undefined : { filter: DATA_SERIES_CONFIG.sg.filter }}
          />


          {/* Average temp - main temperature with gradient that fades downward */}
          <Area
            yAxisId="temp"
            type={areaType}
            dataKey="avgTemp"
            stroke={COLORS.temp}
            strokeWidth={DATA_SERIES_CONFIG.avgTemp.strokeWidth}
            fill={`url(#avgTempGrad-${chartIndex})`}
            dot={isActiveBrew ? liveDot("temp", lastTempIndex, COLORS.temp) : false}
            activeDot={activeDot({ r: DATA_SERIES_CONFIG.avgTemp.dotRadius, fill: COLORS.temp })}
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
            activeDot={activeDot({ r: DATA_SERIES_CONFIG.controllerTemp.dotRadius, fill: "hsl(var(--temp-blue) / 0.5)" })}
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

          {/* Pill temp - always faint secondary line */}
          <Area
            yAxisId="temp"
            type={areaType}
            dataKey="pillTemp"
            stroke={COLORS.tempFaint}
            strokeWidth={DATA_SERIES_CONFIG.pillTemp.strokeWidth}
            fill="transparent"
            dot={false}
            activeDot={activeDot({ r: DATA_SERIES_CONFIG.pillTemp.dotRadius, fill: "hsl(var(--temp-blue) / 0.5)" })}
            name="pillTemp"
            isAnimationActive={isAnimationActive}
            connectNulls={false}
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
            activeDot={activeDot({ r: DATA_SERIES_CONFIG.targetTemp.dotRadius, fill: COLORS.targetTemp })}
            name="targetTemp"
            isAnimationActive={isAnimationActive}
            connectNulls={false}
          />
          <Customized component={eventOverlay} />
        </ComposedChart>
      </ResponsiveContainer>
      {isActiveBrew && Object.entries(rings).map(([key, r]) => (
        <PointPing key={`ping-${key}`} timestamp={chartData[key === 'sg' ? lastSgIndex : lastTempIndex]?.timestamp ?? 0} x={r.x} y={r.y} color={r.color} enabled={isTvMode} />
      ))}
      {isActiveBrew && Object.entries(rings).map(([key, r]) => (
        <span
          key={key}
          aria-hidden="true"
          className="chart-live-ring pointer-events-none absolute rounded-full"
          style={{ left: r.x - 4, top: r.y - 4, width: 8, height: 8, background: r.color }}
        />
      ))}
    </div>
  );
}

export const BrewChart = memo(BrewChartComponent);
