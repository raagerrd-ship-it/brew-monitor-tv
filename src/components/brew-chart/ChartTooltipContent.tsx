import { memo } from "react";
import { Tooltip } from "recharts";
import { formatTooltipLabel } from "./utils";
import { COLORS } from "./chartConfig";

const tooltipContentStyle = {
  backgroundColor: COLORS.card,
  border: "none",
  borderRadius: "8px",
  color: COLORS.foreground,
  lineHeight: "1",
  padding: "6px 8px",
};

const tooltipLabelStyle = {
  color: COLORS.mutedForeground,
  marginBottom: "1px",
};

const tooltipItemStyle = {
  lineHeight: "1.1",
  padding: "1px 0",
};

function formatTooltipValue(value: number, name: string) {
  if (name === "value") {
    return [value.toFixed(3), "SG"];
  }
  if (name === "controllerTemp") {
    return [
      <span key="ctrl-val" style={{ color: COLORS.temp }}>
        {value.toFixed(1)}°C
      </span>,
      <span key="ctrl-label" style={{ color: COLORS.temp }}>
        Controller
      </span>,
    ];
  }
  if (name === "pillTemp") {
    return [
      <span key="pill-val" style={{ color: "hsl(var(--temp-blue) / 0.5)" }}>
        {value.toFixed(1)}°C
      </span>,
      <span key="pill-label" style={{ color: "hsl(var(--temp-blue) / 0.5)" }}>
        Pill
      </span>,
    ];
  }
  return [value, name];
}

export const ChartTooltip = memo(function ChartTooltip() {
  return (
    <Tooltip
      contentStyle={tooltipContentStyle}
      labelStyle={tooltipLabelStyle}
      itemStyle={tooltipItemStyle}
      labelFormatter={formatTooltipLabel}
      formatter={formatTooltipValue}
    />
  );
});
