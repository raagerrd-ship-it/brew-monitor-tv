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
  Label,
} from "recharts";

interface BrewEvent {
  id: string;
  event_type: string;
  event_date: string;
  notes: string | null;
}

interface BrewChartProps {
  data: Array<{ date: string; value: number; temp: number }>;
  og: number;
  fg: number;
  singleView?: boolean;
  events?: BrewEvent[];
}

export function BrewChart({ data, og, fg, singleView = false, events = [] }: BrewChartProps) {
  // Check if data is empty or has no values
  if (!data || data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-muted-foreground text-lg">N/A</p>
      </div>
    );
  }

  console.log('BrewChart events:', events); // Debug log

  // Convert dates to timestamps for linear scale
  const chartData = data.map(d => ({
    ...d,
    timestamp: new Date(d.date).getTime()
  }));

  // Generate midnight markers for ALL days in the date range
  const sortedDayBoundaries: number[] = [];
  if (chartData.length > 0) {
    const firstDate = new Date(chartData[0].date);
    const lastDate = new Date(chartData[chartData.length - 1].date);
    
    // Start from the first midnight after the first data point
    const currentMidnight = new Date(firstDate);
    currentMidnight.setHours(0, 0, 0, 0);
    currentMidnight.setDate(currentMidnight.getDate() + 1);
    
    // Generate midnight for each day until the last data point
    while (currentMidnight <= lastDate) {
      sortedDayBoundaries.push(currentMidnight.getTime());
      currentMidnight.setDate(currentMidnight.getDate() + 1);
    }
  }

  // Map event type to display label and color
  const getEventDisplay = (type: string) => {
    switch (type) {
      case 'jast':
        return { label: 'Jäst', color: '#eab308' }; // yellow
      case 'syresattning':
        return { label: 'Syresättning', color: '#0ea5e9' }; // cyan
      case 'diacetylrast':
        return { label: 'Diacetylrast', color: '#f97316' }; // orange
      case 'torrhumling':
        return { label: 'Torrhumling', color: '#22c55e' }; // green
      case 'coldcrash':
        return { label: 'Coldcrash', color: '#3b82f6' }; // blue
      default:
        return { label: 'Händelse', color: '#a855f7' }; // purple
    }
  };

  // Sort events by date and convert to timestamps
  const sortedEvents = [...events].sort((a, b) => 
    new Date(a.event_date).getTime() - new Date(b.event_date).getTime()
  ).map(event => ({
    ...event,
    timestamp: new Date(event.event_date).getTime()
  }));

  return (
    <div className="h-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 20, right: -10, left: -20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
          {/* Day change markers */}
          {sortedDayBoundaries.map((timestamp, idx) => (
            <ReferenceLine
              key={`day-${idx}`}
              x={timestamp}
              yAxisId="sg"
              stroke="hsl(var(--primary))"
              strokeDasharray="3 3"
              strokeOpacity={0.4}
              strokeWidth={2}
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
            scale="time"
            stroke="hsl(var(--muted-foreground))"
            style={{ fontSize: "9px" }}
            tick={{ fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={(value) => {
              try {
                const date = new Date(value);
                if (isNaN(date.getTime())) return '';
                const day = date.getDate();
                const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];
                const month = monthNames[date.getMonth()];
                return `${day} ${month}`;
              } catch (e) {
                return '';
              }
            }}
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
            tickFormatter={(value) => `${value}°C`}
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
            labelFormatter={(label) => {
              try {
                const date = new Date(Number(label));
                if (isNaN(date.getTime())) return String(label);
                const day = date.getDate();
                const month = date.getMonth() + 1;
                const hours = date.getHours().toString().padStart(2, '0');
                const minutes = date.getMinutes().toString().padStart(2, '0');
                return `${day}/${month} ${hours}:${minutes}`;
              } catch (e) {
                return String(label);
              }
            }}
            formatter={(value: number, name: string) => {
              if (name === "value") return [value.toFixed(3), "SG"];
              if (name === "temp") return [`${value}°C`, "Temp"];
              return [value, name];
            }}
          />
          <Line
            yAxisId="sg"
            type="natural"
            dataKey="value"
            stroke="hsl(var(--beer-amber))"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 5, fill: "hsl(var(--beer-amber))" }}
            name="value"
            style={{
              filter: "drop-shadow(0 0 6px hsl(var(--beer-amber) / 0.6))"
            }}
          />
          <Area
            yAxisId="temp"
            type="monotone"
            dataKey="temp"
            stroke="hsl(var(--temp-blue) / 0.4)"
            strokeWidth={1}
            fill="hsl(var(--temp-blue) / 0.1)"
            dot={false}
            activeDot={{ r: 4, fill: "hsl(var(--temp-blue) / 0.6)" }}
            name="temp"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
