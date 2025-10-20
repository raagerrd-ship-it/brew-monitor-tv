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
} from "recharts";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ZoomIn } from "lucide-react";

interface BrewChartProps {
  data: Array<{ date: string; value: number; temp: number }>;
  og: number;
  fg: number;
  singleView?: boolean;
}

type ZoomPeriod = '24h' | '48h' | '7d' | 'all';

export function BrewChart({ data, og, fg, singleView = false }: BrewChartProps) {
  const [zoomPeriod, setZoomPeriod] = useState<ZoomPeriod>('all');
  
  // Filter data based on selected zoom period
  const getFilteredData = () => {
    if (zoomPeriod === 'all' || !data || data.length === 0) {
      return data;
    }
    
    const now = new Date();
    const hoursToShow = zoomPeriod === '24h' ? 24 : zoomPeriod === '48h' ? 48 : 168; // 7d = 168h
    const cutoffTime = new Date(now.getTime() - hoursToShow * 60 * 60 * 1000);
    
    return data.filter(d => new Date(d.date) >= cutoffTime);
  };
  
  const filteredData = getFilteredData();
  // Check if data is empty or has no values
  if (!filteredData || filteredData.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-muted-foreground text-lg">N/A</p>
      </div>
    );
  }

  // Find all unique midnight timestamps (day boundaries)
  const midnightTimestamps = new Set<number>();
  filteredData.forEach((d) => {
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
    let closestReading = filteredData[0];
    let minDistance = Math.abs(new Date(filteredData[0].date).getTime() - midnightTime);
    
    filteredData.forEach((d) => {
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
  const dayGroups = new Map<string, typeof filteredData>();
  
  filteredData.forEach((d) => {
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

  const zoomButtons: Array<{ period: ZoomPeriod; label: string }> = [
    { period: '24h', label: '24h' },
    { period: '48h', label: '48h' },
    { period: '7d', label: '7 dagar' },
    { period: 'all', label: 'Allt' },
  ];

  return (
    <div className="h-full relative">
      {/* Zoom controls - Overlay on chart */}
      <div className="absolute top-1 right-1 z-20">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 bg-background/70 backdrop-blur-sm border border-border/40 opacity-70 hover:opacity-100 hover:bg-background/90 transition-all"
              title="Zooma diagram"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2" align="end">
            <div className="flex flex-col gap-1">
              {zoomButtons.map(({ period, label }) => (
                <Button
                  key={period}
                  variant={zoomPeriod === period ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setZoomPeriod(period)}
                  className="justify-start"
                >
                  {label}
                </Button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      
      <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={filteredData} margin={{ top: 5, right: -10, left: -20, bottom: 5 }}>
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
