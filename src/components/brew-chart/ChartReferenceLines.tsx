import { memo } from "react";
import { ReferenceLine } from "recharts";
import { getEventDisplay } from "./utils";
import { BrewChartEventWithTimestamp } from "./types";
import { COLORS, DAY_BOUNDARY_CONFIG, EVENT_MARKER_CONFIG } from "./chartConfig";

interface DayBoundaryLinesProps {
  dayBoundaries: number[];
}

export const DayBoundaryLines = memo(function DayBoundaryLines({
  dayBoundaries,
}: DayBoundaryLinesProps) {
  return (
    <>
      {dayBoundaries.map((timestamp, idx) => (
        <ReferenceLine
          key={`day-${idx}`}
          x={timestamp}
          yAxisId="sg"
          stroke={COLORS.mutedForeground}
          strokeDasharray={DAY_BOUNDARY_CONFIG.strokeDasharray}
          strokeOpacity={DAY_BOUNDARY_CONFIG.strokeOpacity}
          strokeWidth={DAY_BOUNDARY_CONFIG.strokeWidth}
        />
      ))}
    </>
  );
});

interface EventMarkerLinesProps {
  events: BrewChartEventWithTimestamp[];
}

export const EventMarkerLines = memo(function EventMarkerLines({
  events,
}: EventMarkerLinesProps) {
  return (
    <>
      {events.map((event) => {
        const eventDisplay = getEventDisplay(event.event_type);

        return (
          <ReferenceLine
            key={event.id}
            x={event.timestamp}
            yAxisId="sg"
            stroke={eventDisplay.color}
            strokeWidth={EVENT_MARKER_CONFIG.strokeWidth}
            label={{
              value: eventDisplay.label,
              position: EVENT_MARKER_CONFIG.labelConfig.position,
              fill: eventDisplay.color,
              fontSize: EVENT_MARKER_CONFIG.labelConfig.fontSize,
              fontWeight: EVENT_MARKER_CONFIG.labelConfig.fontWeight,
              angle: EVENT_MARKER_CONFIG.labelConfig.angle,
              offset: EVENT_MARKER_CONFIG.labelConfig.offset,
            }}
          />
        );
      })}
    </>
  );
});
