import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface SettingsSectionProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  variant?: "default" | "muted";
  headerAction?: React.ReactNode;
}

/**
 * Groups related settings into a visually distinct container
 * with a section header and subtle background.
 */
export function SettingsSection({
  icon: Icon,
  title,
  description,
  children,
  className,
  variant = "default",
  headerAction,
}: SettingsSectionProps) {
  return (
    <div
      className={cn(
        "rounded-xl border p-5 space-y-4",
        variant === "default"
          ? "bg-card/50 border-border"
          : "bg-muted/20 border-border/60",
        className
      )}
      style={{ containerType: 'inline-size' } as React.CSSProperties}
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <div className="absolute inset-0 bg-primary/20 blur-lg rounded-full" />
          <div className="relative flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10 border border-primary/30">
            <Icon className="h-4.5 w-4.5 text-primary" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {headerAction && <div className="flex-shrink-0">{headerAction}</div>}
      </div>

      {/* Content */}
      <div className="space-y-4">{children}</div>
    </div>
  );
}

/**
 * A styled separator for use within SettingsSection.
 * Uses a gradient with primary accent for better visibility.
 */
export function SettingsDivider({ className }: { className?: string }) {
  return (
    <div className={cn("h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent", className)} />
  );
}

/**
 * A category separator with a centered label pill, used to visually
 * group related settings sections. Matches the TV-LÄGE separator style.
 */
export function CategorySeparator({ 
  icon: Icon, 
  label, 
  className 
}: { 
  icon: LucideIcon; 
  label: string; 
  className?: string;
}) {
  return (
    <div className={cn("relative flex items-center gap-4 pt-4", className)}>
      <div className="flex-1 h-px bg-border" />
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50 border border-border/60">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}
