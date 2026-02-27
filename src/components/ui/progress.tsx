import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/lib/utils";

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & {
    indicatorClassName?: string;
    indicatorStyle?: React.CSSProperties;
  }
>(({ className, value, indicatorClassName, indicatorStyle, ...props }, ref) => {
  const percentage = value || 0;
  
  return (
    <div
      ref={ref}
      className={cn("relative h-4 w-full overflow-hidden rounded-full bg-secondary/20", className)}
      {...props}
    >
      <div
        className={cn("h-full transition-all duration-300 rounded-full bg-primary", indicatorClassName)}
        style={{ width: `${percentage}%`, ...indicatorStyle }}
      />
    </div>
  );
});
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
