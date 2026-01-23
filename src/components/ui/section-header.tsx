import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  className?: string;
}

export function SectionHeader({ icon: Icon, title, description, className }: SectionHeaderProps) {
  return (
    <div className={cn("relative", className)}>
      {/* Gradient line */}
      <div className="absolute left-0 top-0 bottom-0 w-1 rounded-full bg-gradient-to-b from-primary via-primary/50 to-transparent" />
      
      <div className="pl-4">
        <div className="flex items-center gap-3">
          {/* Icon with glow effect */}
          <div className="relative">
            <div className="absolute inset-0 bg-primary/20 blur-lg rounded-full" />
            <div className="relative flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 backdrop-blur-sm">
              <Icon className="h-4.5 w-4.5 text-primary" />
            </div>
          </div>
          
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            {description && (
              <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
