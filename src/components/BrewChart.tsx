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

  // Find all unique midnight timestamps (day boundaries)
  const midnightTimestamps = new Set<number>();
  data.forEach((d) => {
    const date = new Date(d.date);
    const midnight = new Date(date);
    midnight.setHours(0, 0, 0, 0);
    midnightTimestamps.add(midnight.getTime());
  });
  
  // For each midnight (except the first day), find the closest reading
  const sortedMidnights = Array.from(midnightTimestamps).sort();
  const dayChangeMarkers: string[] = [];
  
  for (let i = 1; i < sortedMidnights.length; i++) {
    const midnightTime = sortedMidnights[i];
    
    // Find the reading closest to this midnight
    let closestReading = data[0];
    let minDistance = Math.abs(new Date(data[0].date).getTime() - midnightTime);
    
    data.forEach((d) => {
      const distance = Math.abs(new Date(d.date).getTime() - midnightTime);
      if (distance < minDistance) {
        minDistance = distance;
        closestReading = d;
      }
    });
    
    dayChangeMarkers.push(closestReading.date);
  }
  
  // Find points to show labels for (closest to 00:00 each day - once per day)
  const labelPoints = new Set<string>();
  const dayGroups = new Map<string, typeof data>();
  
  data.forEach((d) => {
    const date = new Date(d.date);
    const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    if (!dayGroups.has(dayKey)) {
      dayGroups.set(dayKey, []);
    }
    dayGroups.get(dayKey)!.push(d);
  });
  
  dayGroups.forEach((dayData) => {
    // Find closest to midnight (00:00)
    let closestToMidnight = dayData[0];
    let minMidnightDist = Math.abs(new Date(dayData[0].date).getHours() * 60 + new Date(dayData[0].date).getMinutes());
    
    dayData.forEach((d) => {
      const date = new Date(d.date);
      const midnightDist = Math.abs(date.getHours() * 60 + date.getMinutes());
      
      if (midnightDist < minMidnightDist) {
        minMidnightDist = midnightDist;
        closestToMidnight = d;
      }
    });
    
    labelPoints.add(closestToMidnight.date);
  });

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

  // Find the closest data point to each event for more accurate positioning
  const getClosestDataPoint = (eventDate: string) => {
    const eventTime = new Date(eventDate).getTime();
    let closest = data[0];
    let minDiff = Math.abs(new Date(data[0].date).getTime() - eventTime);
    
    data.forEach((point) => {
      const diff = Math.abs(new Date(point.date).getTime() - eventTime);
      if (diff < minDiff) {
        minDiff = diff;
        closest = point;
      }
    });
    
    return closest.date;
  };

  // Sort events by date and calculate offsets to prevent overlap
  const sortedEvents = [...events].sort((a, b) => 
    new Date(a.event_date).getTime() - new Date(b.event_date).getTime()
  );
  
  // Map each event to its closest data point
  const eventsWithPosition = sortedEvents.map(event => ({
    event,
    closestDate: getClosestDataPoint(event.event_date)
  }));
  
  // Group events by their closest data point
  const eventGroups = new Map<string, typeof eventsWithPosition>();
  eventsWithPosition.forEach(item => {
    if (!eventGroups.has(item.closestDate)) {
      eventGroups.set(item.closestDate, []);
    }
    eventGroups.get(item.closestDate)!.push(item);
  });
  
  // Calculate offset for each event based on its position in the group
  const eventOffsets = new Map<string, number>();
  eventGroups.forEach((group) => {
    group.forEach((item, indexInGroup) => {
      // Stack labels vertically when multiple events are at the same position
      const offset = 10 + (indexInGroup * 25);
      eventOffsets.set(item.event.id, offset);
    });
  });

  return (
    <div className="h-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 20, right: -10, left: -20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
          {/* Day change markers */}
          {dayChangeMarkers.map((timestamp, idx) => (
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
          {eventsWithPosition.map((item) => {
            const eventDisplay = getEventDisplay(item.event.event_type);
            const offset = eventOffsets.get(item.event.id) || 10;
            console.log('Rendering event:', item.event.event_type, 'at', item.closestDate, 'offset:', offset); // Debug
            return (
              <ReferenceLine
                key={item.event.id}
                x={item.closestDate}
                yAxisId="sg"
                stroke={eventDisplay.color}
                strokeWidth={3}
                label={{
                  value: eventDisplay.label,
                  position: 'top',
                  fill: eventDisplay.color,
                  fontSize: 14,
                  fontWeight: 'bold',
                  offset: offset
                }}
              />
            );
          })}
          <XAxis
            dataKey="date"
            stroke="hsl(var(--muted-foreground))"
            style={{ fontSize: "9px" }}
            tick={{ fill: "hsl(var(--muted-foreground))" }}
            ticks={Array.from(labelPoints)}
            tickFormatter={(value) => {
              if (!value) return '';
              
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
              if (!label) return '';
              try {
                const date = new Date(label);
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
