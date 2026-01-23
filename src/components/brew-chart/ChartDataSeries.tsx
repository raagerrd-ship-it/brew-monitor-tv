import { memo } from "react";
import { Area, Line } from "recharts";
import { COLORS, DATA_SERIES_CONFIG } from "./chartConfig";

type LineType = "monotoneX" | "linear";

interface SGLineProps {
  lineType: LineType;
  isAnimationActive: boolean;
}

export const SGLine = memo(function SGLine({ lineType, isAnimationActive }: SGLineProps) {
  return (
    <Line
      yAxisId="sg"
      type={lineType}
      dataKey="value"
      stroke={COLORS.sg}
      strokeWidth={DATA_SERIES_CONFIG.sg.strokeWidth}
      dot={false}
      activeDot={{ r: DATA_SERIES_CONFIG.sg.dotRadius, fill: COLORS.sg }}
      name="value"
      isAnimationActive={isAnimationActive}
      style={{
        filter: DATA_SERIES_CONFIG.sg.filter,
      }}
    />
  );
});

interface ControllerTempAreaProps {
  areaType: LineType;
  isAnimationActive: boolean;
}

export const ControllerTempArea = memo(function ControllerTempArea({
  areaType,
  isAnimationActive,
}: ControllerTempAreaProps) {
  return (
    <Area
      yAxisId="temp"
      type={areaType}
      dataKey="controllerTemp"
      stroke={COLORS.temp}
      strokeWidth={DATA_SERIES_CONFIG.controllerTemp.strokeWidth}
      fill={COLORS.tempFill}
      dot={false}
      activeDot={{ r: DATA_SERIES_CONFIG.controllerTemp.dotRadius, fill: COLORS.temp }}
      name="controllerTemp"
      isAnimationActive={isAnimationActive}
      connectNulls={false}
    />
  );
});

interface PillTempLineProps {
  lineType: LineType;
  isAnimationActive: boolean;
}

export const PillTempLine = memo(function PillTempLine({
  lineType,
  isAnimationActive,
}: PillTempLineProps) {
  return (
    <Line
      yAxisId="temp"
      type={lineType}
      dataKey="pillTemp"
      stroke={COLORS.tempFaint}
      strokeWidth={DATA_SERIES_CONFIG.pillTemp.strokeWidth}
      dot={false}
      activeDot={{ r: DATA_SERIES_CONFIG.pillTemp.dotRadius, fill: "hsl(var(--temp-blue) / 0.5)" }}
      name="pillTemp"
      isAnimationActive={isAnimationActive}
    />
  );
});
