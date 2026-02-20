import { LineChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ComposedChart } from 'recharts';
import { Loader2 } from 'lucide-react';
import { useControllerTempData } from './hooks/useControllerTempData';
import { CHART_MARGINS, COLORS, AXIS_CONFIG, TOOLTIP_STYLE, LINE_CONFIG } from './chartConfig';

interface ControllerTempChartProps {
  controllerId: string;
  controllerColor?: string;
}

export function ControllerTempChart({ controllerId, controllerColor = '#3b82f6' }: ControllerTempChartProps) {
  const { data, loading, timeRange, setTimeRange, minTemp, maxTemp } = useControllerTempData({ controllerId });

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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Temperaturhistorik</span>
        <div className="flex gap-1">
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
          <button
            onClick={() => setTimeRange('7d')}
            className={`px-2 py-0.5 text-xs rounded transition-colors ${
              timeRange === '7d' 
                ? 'bg-primary text-primary-foreground' 
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            7d
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
              domain={[minTemp, maxTemp]}
              tick={AXIS_CONFIG.tick}
              className="text-muted-foreground"
              tickFormatter={(value) => `${value}°`}
            />
            <Tooltip 
              contentStyle={TOOLTIP_STYLE}
              formatter={(value: number, name: string) => [
                `${value.toFixed(1)}°`, 
                name === 'currentTemp' ? 'Aktuell' : 'Mål'
              ]}
              labelFormatter={(label) => `Tid: ${label}`}
            />
            <Legend 
              formatter={(value) => value === 'currentTemp' ? 'Aktuell temp' : 'Måltemp'}
              wrapperStyle={{ fontSize: '11px' }}
            />
            <Area 
              type={LINE_CONFIG.current.type}
              dataKey="currentTemp" 
              stroke={controllerColor}
              strokeWidth={LINE_CONFIG.current.strokeWidth}
              fill={controllerColor}
              fillOpacity={0.08}
              dot={LINE_CONFIG.current.dot}
              name="currentTemp"
            />
            <Line 
              type={LINE_CONFIG.target.type}
              dataKey="targetTemp" 
              stroke={COLORS.target}
              strokeWidth={LINE_CONFIG.target.strokeWidth}
              strokeDasharray={LINE_CONFIG.target.strokeDasharray}
              dot={LINE_CONFIG.target.dot}
              name="targetTemp"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
