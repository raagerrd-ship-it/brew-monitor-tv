import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
  ReferenceLine,
} from "recharts";

interface BrewChartProps {
  data: Array<{ date: string; value: number; temp: number }>;
  og: number;
  fg: number;
  singleView?: boolean;
}

export function BrewChart({ data, og, fg, singleView = false }: BrewChartProps) {
  // Check if data is empty or has no values
  if (!data || data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-muted-foreground text-lg">N/A</p>
      </div>
    );
  }

  // Find day changes for reference lines
  const dayChangeMarkers: string[] = [];
  for (let i = 1; i < data.length; i++) {
    const prevDate = new Date(data[i - 1].date);
    const currDate = new Date(data[i].date);
    
    // Check if day changed
    if (prevDate.getDate() !== currDate.getDate() || 
        prevDate.getMonth() !== currDate.getMonth()) {
      dayChangeMarkers.push(data[i].date);
    }
  }
  
  console.log('Day change markers:', dayChangeMarkers);

  return (
    <div className="h-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
          {/* Day change markers */}
          {dayChangeMarkers.map((timestamp, idx) => (
            <ReferenceLine
              key={idx}
              x={timestamp}
              yAxisId="sg"
              stroke="hsl(var(--primary))"
              strokeDasharray="3 3"
              strokeOpacity={0.4}
              strokeWidth={2}
            />
          ))}
          <XAxis
            dataKey="date"
            stroke="hsl(var(--muted-foreground))"
            style={{ fontSize: "9px" }}
            tick={{ fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={(value) => {
              if (!value) return '';
              try {
                const date = new Date(value);
                if (isNaN(date.getTime())) return String(value);
                const day = date.getDate();
                const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];
                const month = monthNames[date.getMonth()];
                const hours = date.getHours().toString().padStart(2, '0');
                const minutes = date.getMinutes().toString().padStart(2, '0');
                return `${day} ${month} ${hours}:${minutes}`;
              } catch (e) {
                return String(value);
              }
            }}
          />
          {/* Left Y-axis for SG */}
          <YAxis
            yAxisId="sg"
            domain={['dataMin - 0.001', 'dataMax + 0.001']}
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
              border: "1px solid hsl(var(--border))",
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
          <Legend
            wrapperStyle={{ color: "hsl(var(--foreground))", fontSize: "11px" }}
            formatter={(value) => {
              if (value === "value") return "SG";
              if (value === "temp") return "Temperatur";
              return value;
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
