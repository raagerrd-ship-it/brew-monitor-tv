import { memo } from "react";

interface RadialGaugeProps {
  /** Progress 0-1 */
  value: number;
  /** Size in px */
  size?: number;
  /** Stroke width */
  strokeWidth?: number;
  /** Track color */
  trackColor?: string;
  /** Fill color (HSL string or CSS color) */
  fillColor?: string;
  /** Optional secondary arc for a second metric */
  secondaryValue?: number;
  secondaryColor?: string;
  /** Center label */
  label?: string;
  /** Sub-label below the main label */
  subLabel?: string;
  /** Icon element to show in center */
  icon?: React.ReactNode;
  /** Whether to animate */
  animated?: boolean;
}

export const RadialGauge = memo(function RadialGauge({
  value,
  size = 80,
  strokeWidth = 5,
  trackColor = "hsl(0 0% 100% / 0.08)",
  fillColor = "hsl(var(--primary))",
  secondaryValue,
  secondaryColor,
  label,
  subLabel,
  icon,
  animated = true,
}: RadialGaugeProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedValue = Math.max(0, Math.min(1, value));
  const offset = circumference * (1 - clampedValue);

  const secondaryOffset = secondaryValue != null
    ? circumference * (1 - Math.max(0, Math.min(1, secondaryValue)))
    : circumference;

  return (
    <div className="relative flex flex-col items-center" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="transform -rotate-90"
      >
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {/* Secondary fill (behind primary) */}
        {secondaryValue != null && secondaryColor && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={secondaryColor}
            strokeWidth={strokeWidth - 1}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={secondaryOffset}
            style={animated ? { transition: "stroke-dashoffset 1s ease-in-out" } : undefined}
            opacity={0.4}
          />
        )}
        {/* Primary fill */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={fillColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={animated ? { transition: "stroke-dashoffset 1s ease-in-out" } : undefined}
        />
        {/* Glow effect */}
        {clampedValue > 0.05 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={fillColor}
            strokeWidth={strokeWidth + 4}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            opacity={0.15}
            style={animated ? { transition: "stroke-dashoffset 1s ease-in-out" } : undefined}
          />
        )}
      </svg>
      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {icon && <div className="mb-0.5">{icon}</div>}
        {label && (
          <span
            className="font-bold leading-none"
            style={{
              fontSize: size > 70 ? '14px' : '11px',
              color: fillColor,
              textShadow: `0 0 12px ${fillColor}40`,
            }}
          >
            {label}
          </span>
        )}
        {subLabel && (
          <span
            className="text-muted-foreground leading-tight mt-0.5"
            style={{ fontSize: size > 70 ? '9px' : '8px' }}
          >
            {subLabel}
          </span>
        )}
      </div>
    </div>
  );
});
