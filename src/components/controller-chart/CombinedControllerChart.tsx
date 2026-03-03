import { useState, useMemo } from 'react';
import { Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart } from 'recharts';
import { Loader2, Snowflake } from 'lucide-react';
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

export function CombinedControllerChart({ controllers }: CombinedControllerChartProps) {
  const [visibleIds, setVisibleIds] = useState<Set<string>>(() => new Set(controllers.map(c => c.id)));
  const { data, loading, timeRange, setTimeRange } = useMultiControllerTempData({ controllers });

  const toggleController = (id: string) => {
    setVisibleIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Build label map
  const labelMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of controllers) {
      map[`${c.id}_cooling`] = `${c.name}`;
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

      {/* Toggle buttons */}
      <div className="flex flex-wrap gap-1.5">
        {controllers.map(ctrl => {
          const active = visibleIds.has(ctrl.id);
          return (
            <button
              key={ctrl.id}
              onClick={() => toggleController(ctrl.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                active
                  ? 'border-border bg-card/80 text-foreground'
                  : 'border-transparent bg-muted/40 text-muted-foreground opacity-50'
              }`}
            >
              {ctrl.isGlycolCooler ? (
                <Snowflake className="h-3 w-3" style={{ color: active ? ctrl.color : undefined }} />
              ) : (
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: active ? ctrl.color : 'hsl(var(--muted-foreground))' }}
                />
              )}
              {ctrl.name}
            </button>
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
            <YAxis
              domain={[0, 100]}
              tick={AXIS_CONFIG.tick}
              className="text-muted-foreground"
              tickFormatter={(value) => `${value}%`}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value: number, name: string) => [`${value}%`, labelMap[name] || name]}
              labelFormatter={(label) => `Tid: ${label}`}
            />

            {controllers.filter(c => visibleIds.has(c.id)).map(ctrl => (
              <Area
                key={`${ctrl.id}_cooling`}
                type="stepAfter"
                dataKey={`${ctrl.id}_cooling`}
                stroke={ctrl.color}
                strokeWidth={1.5}
                fill={ctrl.color}
                fillOpacity={0.15}
                dot={false}
                name={`${ctrl.id}_cooling`}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
