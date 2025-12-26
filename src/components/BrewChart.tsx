import { useState } from "react";
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
import { Button } from "./ui/button";
import { TrendingUp } from "lucide-react";

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
  const [smoothLines, setSmoothLines] = useState(true);
  
  // Check if data is empty or has no values
  if (!data || data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-muted-foreground text-lg">N/A</p>
      </div>
    );
  }

  console.log('BrewChart events:', events); // Debug log
  
  const lineType = smoothLines ? "monotoneX" : "linear";
  const areaType = smoothLines ? "monotoneX" : "linear";

  // Calculate moving average for smoother lines
  const calculateMovingAverage = (data: Array<{ date: string; value: number; temp: number }>, windowSize: number) => {
    if (!smoothLines || windowSize < 2) return data;
    
    const result = [];
    for (let i = 0; i < data.length; i++) {
      const start = Math.max(0, i - Math.floor(windowSize / 2));
      const end = Math.min(data.length, i + Math.ceil(windowSize / 2));
      const window = data.slice(start, end);
      
      const avgValue = window.reduce((sum, d) => sum + d.value, 0) / window.length;
      const avgTemp = window.reduce((sum, d) => sum + d.temp, 0) / window.length;
      
      result.push({
        ...data[i],
        value: avgValue,
        temp: avgTemp
      });
    }
    return result;
  };

  // Determine window size based on data length (5-10% of data points)
  const windowSize = Math.max(3, Math.floor(data.length * 0.08));
  const smoothedData = calculateMovingAverage(data, windowSize);

  // Convert dates to timestamps for linear scale
  const chartData = smoothedData.map(d => ({
    ...d,
    timestamp: new Date(d.date).getTime()
  }));

  // Generate midnight markers for ALL days in the date range (for reference lines)
  const dayBoundariesForLines: number[] = [];
  // Generate unique day ticks for X-axis labels (one per day)
  const uniqueDayTicks: number[] = [];
  
  if (chartData.length > 0) {
    const firstTimestamp = chartData[0].timestamp;
    const lastTimestamp = chartData[chartData.length - 1].timestamp;
    const firstDate = new Date(chartData[0].date);
    const lastDate = new Date(chartData[chartData.length - 1].date);
    
    // First tick should be at the first data point (not midnight)
    uniqueDayTicks.push(firstTimestamp);
    
    // Start from midnight of the first day
    const firstMidnight = new Date(firstDate);
    firstMidnight.setHours(0, 0, 0, 0);
    
    // Add subsequent day ticks at midnight (only if different from first day)
    const currentDay = new Date(firstMidnight);
    currentDay.setDate(currentDay.getDate() + 1);
    while (currentDay <= lastDate) {
      const dayTimestamp = currentDay.getTime();
      // Only add if it's within the data range
      if (dayTimestamp >= firstTimestamp && dayTimestamp <= lastTimestamp) {
        uniqueDayTicks.push(dayTimestamp);
      }
      currentDay.setDate(currentDay.getDate() + 1);
    }
    
    // Day boundary lines start from midnight AFTER first day
    const currentMidnight = new Date(firstMidnight);
    currentMidnight.setDate(currentMidnight.getDate() + 1);
    
    // Generate midnight for each day until the last data point
    while (currentMidnight <= lastDate) {
      dayBoundariesForLines.push(currentMidnight.getTime());
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

  // Sort events by date and convert to timestamps, showing only one per day
  const getEventsPerDay = () => {
    const eventsByDay = new Map<string, typeof events[0]>();
    
    // Group events by day, keeping only one per day
    events.forEach(event => {
      const eventDate = new Date(event.event_date);
      const dayKey = `${eventDate.getFullYear()}-${eventDate.getMonth()}-${eventDate.getDate()}`;
      
      // Keep the first event of each day (or could prioritize by type)
      if (!eventsByDay.has(dayKey)) {
        eventsByDay.set(dayKey, event);
      }
    });
    
    return Array.from(eventsByDay.values())
      .sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime())
      .map(event => ({
        ...event,
        timestamp: new Date(event.event_date).getTime()
      }));
  };

  const sortedEvents = getEventsPerDay();

  return (
    <div className="h-full relative group">
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 left-10 z-10 h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
        onClick={() => setSmoothLines(!smoothLines)}
        title={smoothLines ? "Visa raka linjer" : "Visa utjämnade linjer"}
      >
        <TrendingUp className={smoothLines ? "text-primary" : "text-muted-foreground"} />
      </Button>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 20, right: -10, left: -20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
          {/* Day change markers */}
          {dayBoundariesForLines.map((timestamp, idx) => (
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
            stroke="hsl(var(--muted-foreground))"
            style={{ fontSize: "9px" }}
            tick={{ fill: "hsl(var(--muted-foreground))" }}
            ticks={uniqueDayTicks}
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
              if (name === "temp") return [
                <span style={{ color: "hsl(var(--temp-blue) / 0.9)" }}>{value.toFixed(1)}°C</span>,
                <span style={{ color: "hsl(var(--temp-blue) / 0.9)" }}>Temp</span>
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
            style={{
              filter: "drop-shadow(0 0 6px hsl(var(--beer-amber) / 0.6))"
            }}
          />
          <Area
            yAxisId="temp"
            type={areaType}
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
