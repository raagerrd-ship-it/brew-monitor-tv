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

  return (
    <div className="h-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data}>
          <defs>
            <linearGradient id="sgGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--beer-amber))" stopOpacity={0.8} />
              <stop offset="95%" stopColor="hsl(var(--beer-amber))" stopOpacity={0.1} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
          <XAxis
            dataKey="date"
            stroke="hsl(var(--muted-foreground))"
            style={{ fontSize: "10px" }}
            tick={{ fill: "hsl(var(--muted-foreground))" }}
          />
          {/* Left Y-axis for SG */}
          <YAxis
            yAxisId="sg"
            domain={[fg - 0.005, og + 0.005]}
            stroke="hsl(var(--beer-amber))"
            style={{ fontSize: "10px" }}
            tick={{ fill: "hsl(var(--beer-amber))" }}
            tickFormatter={(value) => value.toFixed(3)}
          />
          {/* Right Y-axis for Temperature */}
          <YAxis
            yAxisId="temp"
            orientation="right"
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
            }}
            labelStyle={{ color: "hsl(var(--muted-foreground))" }}
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
          <Area
            yAxisId="sg"
            type="monotone"
            dataKey="value"
            stroke="hsl(var(--beer-amber))"
            strokeWidth={2}
            fill="url(#sgGradient)"
            name="value"
          />
          <Line
            yAxisId="temp"
            type="monotone"
            dataKey="temp"
            stroke="hsl(var(--temp-blue))"
            strokeWidth={2}
            dot={{ fill: "hsl(var(--temp-blue))", r: 3 }}
            activeDot={{ r: 5, fill: "hsl(var(--temp-blue))" }}
            name="temp"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
