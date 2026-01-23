import { memo } from "react";
import { XAxis, YAxis } from "recharts";
import { formatXAxisTick } from "./utils";
import { COLORS, AXIS_STYLES } from "./chartConfig";

interface ChartXAxisProps {
  dayTicks: number[];
}

export const ChartXAxis = memo(function ChartXAxis({ dayTicks }: ChartXAxisProps) {
  return (
    <XAxis
      dataKey="timestamp"
      type="number"
      domain={["dataMin", "dataMax"]}
      stroke={COLORS.mutedForeground}
      style={{ fontSize: AXIS_STYLES.fontSize.x }}
      tick={{ fill: COLORS.mutedForeground }}
      ticks={dayTicks}
      tickFormatter={formatXAxisTick}
    />
  );
});

interface SGYAxisProps {
  og: number;
  fg: number;
}

export const SGYAxis = memo(function SGYAxis({ og, fg }: SGYAxisProps) {
  return (
    <YAxis
      yAxisId="sg"
      domain={[fg - 0.001, og + 0.001]}
      stroke={COLORS.sg}
      style={{ fontSize: AXIS_STYLES.fontSize.y }}
      tick={{ fill: COLORS.sg }}
      tickFormatter={(value) => value.toFixed(3)}
    />
  );
});

export const TempYAxis = memo(function TempYAxis() {
  return (
    <YAxis
      yAxisId="temp"
      orientation="right"
      domain={["dataMin - 0.5", "dataMax + 0.5"]}
      stroke={COLORS.temp}
      style={{ fontSize: AXIS_STYLES.fontSize.y }}
      tick={{ fill: COLORS.temp }}
      tickFormatter={(value) => `${value.toFixed(1)}°C`}
    />
  );
});
