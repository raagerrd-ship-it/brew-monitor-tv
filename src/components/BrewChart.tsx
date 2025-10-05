import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
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
}

export function BrewChart({ data, og, fg }: BrewChartProps) {
  return (
    <div className="space-y-3 h-full flex flex-col">
      {/* SG Chart */}
      <div className="flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
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
            <YAxis
              domain={[fg - 0.005, og + 0.005]}
              stroke="hsl(var(--muted-foreground))"
              style={{ fontSize: "10px" }}
              tick={{ fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={(value) => value.toFixed(3)}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
                color: "hsl(var(--foreground))",
              }}
              labelStyle={{ color: "hsl(var(--muted-foreground))" }}
              formatter={(value: number) => [value.toFixed(3), "SG"]}
            />
            <Legend
              wrapperStyle={{ color: "hsl(var(--foreground))", fontSize: "11px" }}
              formatter={() => "SG"}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="hsl(var(--beer-amber))"
              strokeWidth={2}
              fill="url(#sgGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Temperature Chart */}
      <div className="flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <defs>
              <linearGradient id="tempGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--temp-blue))" stopOpacity={0.8} />
                <stop offset="95%" stopColor="hsl(var(--temp-blue))" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
            <XAxis
              dataKey="date"
              stroke="hsl(var(--muted-foreground))"
              style={{ fontSize: "10px" }}
              tick={{ fill: "hsl(var(--muted-foreground))" }}
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              style={{ fontSize: "10px" }}
              tick={{ fill: "hsl(var(--muted-foreground))" }}
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
              formatter={(value: number) => [`${value}°C`, "Temp"]}
            />
            <Legend
              wrapperStyle={{ color: "hsl(var(--foreground))", fontSize: "11px" }}
              formatter={() => "Temp"}
            />
            <Line
              type="monotone"
              dataKey="temp"
              stroke="hsl(var(--temp-blue))"
              strokeWidth={2}
              dot={{ fill: "hsl(var(--temp-blue))", r: 3 }}
              activeDot={{ r: 5, fill: "hsl(var(--temp-blue))" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
