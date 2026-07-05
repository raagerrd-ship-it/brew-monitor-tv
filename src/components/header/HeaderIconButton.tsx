import { forwardRef, ReactNode, ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface HeaderIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  /** Bright (100% opacity) when true — use for active/current-route states. */
  active?: boolean;
  /** If set, renders a small colored attention dot in the top-right corner. */
  dotColor?: string;
  /** Override icon color (default: currentColor / foreground). */
  iconColor?: string;
  label: string;
}

/**
 * Uniform header icon button. Same size, hover, and dot-badge treatment for
 * every control in the dashboard header (Plug, Pi, Timer, Bell, Settings…).
 */
export const HeaderIconButton = forwardRef<HTMLButtonElement, HeaderIconButtonProps>(
  ({ icon, active, dotColor, iconColor, label, className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      title={label}
      aria-label={label}
      className={cn(
        "relative flex items-center justify-center w-10 h-10 rounded-full transition-all duration-200 hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-default disabled:opacity-60",
        active ? "opacity-100" : "opacity-55 hover:opacity-100",
        className,
      )}
      style={iconColor ? { color: iconColor } : undefined}
      {...props}
    >
      <span className="[&_svg]:w-5 [&_svg]:h-5 flex items-center justify-center">
        {icon}
      </span>
      {dotColor && (
        <span
          className="absolute top-1.5 right-1.5 rounded-full pointer-events-none"
          style={{
            width: 8,
            height: 8,
            background: dotColor,
            boxShadow: `0 0 6px ${dotColor}`,
            border: "1.5px solid hsl(222 20% 8%)",
          }}
        />
      )}
    </button>
  ),
);
HeaderIconButton.displayName = "HeaderIconButton";