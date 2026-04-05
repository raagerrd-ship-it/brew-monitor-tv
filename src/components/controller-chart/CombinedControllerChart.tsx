import { useState, useMemo, useCallback } from 'react';
import { Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart } from 'recharts';
import { Loader2, Snowflake, ChevronDown, ChevronRight } from 'lucide-react';
import { useMultiControllerTempData } from './hooks/useMultiControllerTempData';
import { CHART_MARGINS, AXIS_CONFIG, TOOLTIP_STYLE } from './chartConfig';

interface ControllerInfo {
  id: string;
  name: string;
  color: string;
  isGlycolCooler?: boolean;
}

interface CombinedControllerChartProps {
  controllers: ControllerInfo[];
}

/** Metric suffixes and their display config */
const METRICS = [
  { suffix: 'cooling', label: 'Kylning %', type: 'area' as const, dash: undefined },
  { suffix: 'heating', label: 'Värmning %', type: 'area' as const, dash: undefined },
  { suffix: 'probe', label: 'Probe', type: 'line' as const, dash: undefined },
  { suffix: 'actual', label: 'Faktisk', type: 'line' as const, dash: undefined },
  { suffix: 'target', label: 'HW-mål', type: 'line' as const, dash: '5 5' as string | undefined },
  { suffix: 'profile', label: 'Profilmål', type: 'line' as const, dash: '3 3' as string | undefined },
];

/** Slightly adjust color brightness for different metrics of the same controller */
function metricColor(base: string, suffix: string): string {
  // Use the same base color but vary opacity/brightness via CSS filter isn't possible in SVG,
  // so we'll use the base color with subtle style differences (dash, width)
  return base;
}

export function CombinedControllerChart({ controllers }: CombinedControllerChartProps) {
  // Track which controllers are expanded (showing their sub-metrics)
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Track which individual series are visible: key = "{id}_{suffix}"
  const [visible, setVisible] = useState<Set<string>>(() => new Set());

  const { data, loading, timeRange, setTimeRange, tempDomain } = useMultiControllerTempData({ controllers });

  const toggleExpand = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSeries = useCallback((key: string) => {
    setVisible(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleAllForController = useCallback((id: string) => {
    setVisible(prev => {
      const keys = METRICS.map(m => `${id}_${m.suffix}`);
      const allVisible = keys.every(k => prev.has(k));
      const next = new Set(prev);
      if (allVisible) {
        keys.forEach(k => next.delete(k));
      } else {
        keys.forEach(k => next.add(k));
      }
      return next;
    });
  }, []);

  // Compute dynamic temp domain based on VISIBLE temp series only
  const dynamicTempDomain = useMemo<[number, number]>(() => {
    const visibleTempKeys = [...visible].filter(k => !k.endsWith('_cooling') && !k.endsWith('_heating'));
    if (visibleTempKeys.length === 0 || data.length === 0) return tempDomain;
    let min = Infinity;
    let max = -Infinity;
    for (const point of data) {
      for (const key of visibleTempKeys) {
        const val = point[key] as number | null | undefined;
        if (val != null) {
          if (val < min) min = val;
          if (val > max) max = val;
        }
      }
    }
    if (min === Infinity) return tempDomain;
    const range = (max - min) || 1;
    const pad = range * 0.05;
    return [Math.floor((min - pad) * 10) / 10, Math.ceil((max + pad) * 10) / 10];
  }, [data, visible, tempDomain]);

  // Check if we need a temp Y-axis (any temp series visible)
  const hasTempVisible = useMemo(() => {
    for (const key of visible) {
      if (!key.endsWith('_cooling') && !key.endsWith('_heating')) return true;
    }
    return false;
  }, [visible]);

  const hasCoolingVisible = useMemo(() => {
    for (const key of visible) {
      if (key.endsWith('_cooling') || key.endsWith('_heating')) return true;
    }
    return false;
  }, [visible]);

  // Label map for tooltip
  const labelMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of controllers) {
      for (const m of METRICS) {
        map[`${c.id}_${m.suffix}`] = `${c.name} · ${m.label}`;
      }
    }
    return map;
  }, [controllers]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-52">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-52 text-sm text-muted-foreground">
        Ingen historik tillgänglig
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Time range buttons */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Kylningsutnyttjande</span>
        <div className="flex gap-1">
          {(['3h', '24h'] as const).map(range => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                timeRange === range
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      {/* Controller toggles — grouped */}
      <div className="space-y-1">
        {controllers.map(ctrl => {
          const isExpanded = expanded.has(ctrl.id);
          const activeCount = METRICS.filter(m => visible.has(`${ctrl.id}_${m.suffix}`)).length;
          return (
            <div key={ctrl.id}>
              {/* Controller header */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => toggleExpand(ctrl.id)}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all hover:bg-muted/60"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  )}
                  {ctrl.isGlycolCooler ? (
                    <Snowflake className="h-3 w-3" style={{ color: ctrl.color }} />
                  ) : (
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: ctrl.color }}
                    />
                  )}
                  <span>{ctrl.name}</span>
                  {activeCount > 0 && (
                    <span className="text-[10px] text-muted-foreground ml-0.5">({activeCount})</span>
                  )}
                </button>
                {!isExpanded && activeCount === 0 && (
                  <button
                    onClick={() => {
                      toggleSeries(`${ctrl.id}_cooling`);
                      setExpanded(prev => new Set(prev).add(ctrl.id));
                    }}
                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    visa
                  </button>
                )}
              </div>

              {/* Metric toggles (when expanded) */}
              {isExpanded && (
                <div className="flex flex-wrap gap-1 ml-6 mt-0.5 mb-1">
                  {METRICS.map(metric => {
                    const key = `${ctrl.id}_${metric.suffix}`;
                    const active = visible.has(key);
                    return (
                      <button
                        key={key}
                        onClick={() => toggleSeries(key)}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-all ${
                          active
                            ? 'border-border bg-card/80 text-foreground'
                            : 'border-transparent bg-muted/30 text-muted-foreground opacity-50'
                        }`}
                      >
                        {metric.label}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => toggleAllForController(ctrl.id)}
                    className="px-2 py-0.5 rounded-full text-[10px] text-muted-foreground hover:text-foreground border border-transparent hover:border-border transition-all"
                  >
                    alla
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Chart */}
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={CHART_MARGINS}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="time"
              tick={AXIS_CONFIG.tick}
              className="text-muted-foreground"
              interval="preserveStartEnd"
              minTickGap={AXIS_CONFIG.minTickGap}
            />
            {/* Cooling % axis (left) */}
            {hasCoolingVisible && (
              <YAxis
                yAxisId="cooling"
                domain={[0, 100]}
                tick={AXIS_CONFIG.tick}
                className="text-muted-foreground"
                tickFormatter={(value) => `${value}%`}
              />
            )}
            {/* Temperature axis (right, only when temp series visible) */}
            {hasTempVisible && (
              <YAxis
                yAxisId="temp"
                orientation={hasCoolingVisible ? 'right' : 'left'}
                domain={dynamicTempDomain}
                tick={AXIS_CONFIG.tick}
                className="text-muted-foreground"
                tickFormatter={(value) => `${value}°`}
                width={35}
              />
            )}
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value: number, name: string) => {
                if (name.endsWith('_cooling') || name.endsWith('_heating')) return [`${value}%`, labelMap[name] || name];
                if (name.endsWith('_actual')) return [`${(value as number).toFixed(2)}°`, labelMap[name] || name];
                return [`${(value as number).toFixed(1)}°`, labelMap[name] || name];
              }}
              labelFormatter={(label) => `Tid: ${label}`}
            />

            {/* Render series for each controller */}
            {controllers.flatMap(ctrl =>
              METRICS.map(metric => {
                const key = `${ctrl.id}_${metric.suffix}`;
                if (!visible.has(key)) return null;

                if (metric.suffix === 'cooling' || metric.suffix === 'heating') {
                  const isHeating = metric.suffix === 'heating';
                  return (
                    <Area
                      key={key}
                      yAxisId="cooling"
                      type="stepAfter"
                      dataKey={key}
                      stroke={isHeating ? '#ef4444' : ctrl.color}
                      strokeWidth={1.5}
                      fill={isHeating ? '#ef4444' : ctrl.color}
                      fillOpacity={0.12}
                      dot={false}
                      name={key}
                      connectNulls={false}
                    />
                  );
                }

                return (
                  <Line
                    key={key}
                    yAxisId="temp"
                    type={metric.suffix === 'target' || metric.suffix === 'profile' ? 'stepAfter' : 'monotone'}
                    dataKey={key}
                    stroke={metric.suffix === 'actual' ? '#f59e0b' : ctrl.color}
                    strokeWidth={metric.suffix === 'actual' ? 2.5 : metric.suffix === 'probe' ? 2 : 1.5}
                    strokeDasharray={metric.dash ?? undefined}
                    strokeOpacity={metric.suffix === 'probe' ? 0.5 : 1}
                    dot={false}
                    name={key}
                    connectNulls={false}
                  />
                );
              })
            ).filter(Boolean)}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}