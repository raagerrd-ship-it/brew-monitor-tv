import { useState, useCallback, useMemo } from 'react';
import { Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ComposedChart } from 'recharts';
import { Loader2 } from 'lucide-react';
import { useControllerTempData } from './hooks/useControllerTempData';
import { CHART_MARGINS, COLORS, AXIS_CONFIG, TOOLTIP_STYLE, LINE_CONFIG } from './chartConfig';

interface ControllerTempChartProps {
  controllerId: string;
  controllerColor?: string;
}

const LABEL_MAP: Record<string, string> = {
  currentTemp: 'Probe-temp',
  targetTemp: 'HW-mål',
  coolingPercent: 'Kylning %',
  actualTemp: 'Faktisk temp',
  profileTargetTemp: 'Profilmål',
};

// Lines hidden by default — user clicks legend to show
const DEFAULT_HIDDEN = new Set(['currentTemp', 'profileTargetTemp', 'coolingPercent']);

export function ControllerTempChart({ controllerId, controllerColor = '#3b82f6' }: ControllerTempChartProps) {
  const { data, loading, timeRange, setTimeRange, minTemp, maxTemp } = useControllerTempData({ controllerId });
  const [hidden, setHidden] = useState<Set<string>>(new Set(DEFAULT_HIDDEN));

  // Dynamic temp domain based on visible series only
  const dynamicDomain = useMemo<[number, number]>(() => {
    if (data.length === 0) return [minTemp, maxTemp];
    const tempKeys = ['currentTemp', 'targetTemp', 'actualTemp', 'profileTargetTemp'] as const;
    const visibleKeys = tempKeys.filter(k => !hidden.has(k));
    if (visibleKeys.length === 0) return [minTemp, maxTemp];
    let lo = Infinity, hi = -Infinity;
    for (const d of data) {
      for (const k of visibleKeys) {
        const v = d[k];
        if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v; }
      }
    }
    if (lo === Infinity) return [minTemp, maxTemp];
    const range = (hi - lo) || 1;
    const pad = range * 0.05;
    return [Math.floor((lo - pad) * 10) / 10, Math.ceil((hi + pad) * 10) / 10];
  }, [data, hidden, minTemp, maxTemp]);

  const handleLegendClick = useCallback((e: any) => {
    const key = e.dataKey ?? e.value;
    if (!key) return;
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-44">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-44 text-sm text-muted-foreground">
        Ingen historik tillgänglig
      </div>
    );
  }

  const hasActualTemp = data.some(d => d.actualTemp != null);
  const hasProfileTarget = data.some(d => d.profileTargetTemp != null);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Temperaturhistorik</span>
        <div className="flex gap-1">
          <button
            onClick={() => setTimeRange('3h')}
            className={`px-2 py-0.5 text-xs rounded transition-colors ${
              timeRange === '3h' 
                ? 'bg-primary text-primary-foreground' 
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            3h
          </button>
          <button
            onClick={() => setTimeRange('24h')}
            className={`px-2 py-0.5 text-xs rounded transition-colors ${
              timeRange === '24h' 
                ? 'bg-primary text-primary-foreground' 
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            24h
          </button>
        </div>
      </div>
      
      <div className="h-44">
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
            <YAxis 
              yAxisId="temp"
              domain={dynamicDomain}
              tick={AXIS_CONFIG.tick}
              className="text-muted-foreground"
              tickFormatter={(value) => `${value}°`}
            />
            <YAxis 
              yAxisId="cooling"
              orientation="right"
              domain={[0, 100]}
              tick={AXIS_CONFIG.tick}
              className="text-muted-foreground"
              tickFormatter={(value) => `${value}%`}
              width={35}
            />
            <Tooltip 
              contentStyle={TOOLTIP_STYLE}
              formatter={(value: number, name: string) => {
                if (name === 'coolingPercent') return [`${value}%`, LABEL_MAP[name]];
                return [`${value.toFixed(1)}°`, LABEL_MAP[name] ?? name];
              }}
              labelFormatter={(label) => `Tid: ${label}`}
            />
            <Legend 
              onClick={handleLegendClick}
              formatter={(value) => (
                <span style={{ opacity: hidden.has(value) ? 0.35 : 1, cursor: 'pointer' }}>
                  {LABEL_MAP[value] ?? value}
                </span>
              )}
              wrapperStyle={{ fontSize: '11px' }}
            />
            {/* Cooling % area */}
            <Area 
              yAxisId="cooling"
              type="stepAfter"
              dataKey="coolingPercent"
              stroke={COLORS.cooling}
              strokeWidth={0}
              fill={COLORS.cooling}
              fillOpacity={0.15}
              dot={false}
              name="coolingPercent"
              hide={hidden.has('coolingPercent')}
            />
            {/* Probe temp (always shown by default) */}
            <Area 
              yAxisId="temp"
              type={LINE_CONFIG.current.type}
              dataKey="currentTemp" 
              stroke={controllerColor}
              strokeWidth={LINE_CONFIG.current.strokeWidth}
              fill={controllerColor}
              fillOpacity={0.08}
              dot={LINE_CONFIG.current.dot}
              name="currentTemp"
              hide={hidden.has('currentTemp')}
            />
            {/* HW target */}
            <Line 
              yAxisId="temp"
              type={LINE_CONFIG.target.type}
              dataKey="targetTemp" 
              stroke={COLORS.target}
              strokeWidth={LINE_CONFIG.target.strokeWidth}
              strokeDasharray={LINE_CONFIG.target.strokeDasharray}
              dot={LINE_CONFIG.target.dot}
              name="targetTemp"
              hide={hidden.has('targetTemp')}
            />
            {/* Actual (fused) temp — hidden by default */}
            {hasActualTemp && (
              <Line 
                yAxisId="temp"
                type="natural"
                dataKey="actualTemp" 
                stroke={COLORS.actualTemp}
                strokeWidth={2}
                dot={false}
                name="actualTemp"
                hide={hidden.has('actualTemp')}
              />
            )}
            {/* Profile target — hidden by default */}
            {hasProfileTarget && (
              <Line 
                yAxisId="temp"
                type="stepAfter"
                dataKey="profileTargetTemp" 
                stroke={COLORS.profileTarget}
                strokeWidth={2}
                strokeDasharray="3 3"
                dot={false}
                name="profileTargetTemp"
                hide={hidden.has('profileTargetTemp')}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}