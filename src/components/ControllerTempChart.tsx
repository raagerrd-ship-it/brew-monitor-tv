import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';

interface ControllerTempChartProps {
  controllerId: string;
  controllerColor?: string;
}

interface HistoryRecord {
  recorded_at: string;
  current_temp: number;
  target_temp: number;
  cooling_enabled: boolean;
}

interface ChartDataPoint {
  time: string;
  timestamp: number;
  currentTemp: number;
  targetTemp: number;
}

export function ControllerTempChart({ controllerId, controllerColor = '#3b82f6' }: ControllerTempChartProps) {
  const [data, setData] = useState<ChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'24h' | '7d'>('24h');

  useEffect(() => {
    const fetchHistory = async () => {
      setLoading(true);
      
      const hoursAgo = timeRange === '24h' ? 24 : 24 * 7;
      const startTime = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
      
      const { data: history, error } = await supabase
        .from('temp_controller_history')
        .select('recorded_at, current_temp, target_temp, cooling_enabled')
        .eq('controller_id', controllerId)
        .gte('recorded_at', startTime.toISOString())
        .order('recorded_at', { ascending: true });

      if (error) {
        console.error('Error fetching temperature history:', error);
        setLoading(false);
        return;
      }

      const chartData: ChartDataPoint[] = (history || []).map((record: HistoryRecord) => ({
        time: format(new Date(record.recorded_at), timeRange === '24h' ? 'HH:mm' : 'dd/MM HH:mm', { locale: sv }),
        timestamp: new Date(record.recorded_at).getTime(),
        currentTemp: Number(record.current_temp),
        targetTemp: Number(record.target_temp),
      }));

      setData(chartData);
      setLoading(false);
    };

    fetchHistory();
  }, [controllerId, timeRange]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
        Ingen historik tillgänglig
      </div>
    );
  }

  // Calculate min/max for Y axis with some padding
  const temps = data.flatMap(d => [d.currentTemp, d.targetTemp]);
  const minTemp = Math.floor(Math.min(...temps)) - 1;
  const maxTemp = Math.ceil(Math.max(...temps)) + 1;

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
      
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis 
              dataKey="time" 
              tick={{ fontSize: 10 }}
              className="text-muted-foreground"
              interval="preserveStartEnd"
              minTickGap={40}
            />
            <YAxis 
              domain={[minTemp, maxTemp]}
              tick={{ fontSize: 10 }}
              className="text-muted-foreground"
              tickFormatter={(value) => `${value}°`}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: 'hsl(var(--background))', 
                border: '1px solid hsl(var(--border))',
                borderRadius: '6px',
                fontSize: '12px'
              }}
              formatter={(value: number, name: string) => [
                `${value.toFixed(1)}°C`, 
                name === 'currentTemp' ? 'Aktuell' : 'Mål'
              ]}
              labelFormatter={(label) => `Tid: ${label}`}
            />
            <Legend 
              formatter={(value) => value === 'currentTemp' ? 'Aktuell temp' : 'Måltemp'}
              wrapperStyle={{ fontSize: '11px' }}
            />
            <Line 
              type="monotone" 
              dataKey="currentTemp" 
              stroke={controllerColor}
              strokeWidth={2}
              dot={false}
              name="currentTemp"
            />
            <Line 
              type="stepAfter" 
              dataKey="targetTemp" 
              stroke="#f59e0b"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={false}
              name="targetTemp"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
