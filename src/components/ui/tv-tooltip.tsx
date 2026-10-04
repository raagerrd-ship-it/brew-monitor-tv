import type { ReactNode } from "react";
import { useTvMode } from "@/contexts/TvModeContext";
import * as T from "@/components/ui/tooltip";

// Samma API som ui/tooltip, men i TV-läge monteras inga Radix-tooltips (ingen hovring på TV:n).
type P = { children?: ReactNode } & Record<string, any>;

export function TooltipProvider(props: P) {
  const { isTvMode } = useTvMode();
  return isTvMode ? <>{props.children}</> : <T.TooltipProvider {...props} />;
}
export function Tooltip(props: P) {
  const { isTvMode } = useTvMode();
  return isTvMode ? <>{props.children}</> : <T.Tooltip {...props} />;
}
export function TooltipTrigger(props: P) {
  const { isTvMode } = useTvMode();
  return isTvMode ? <>{props.children}</> : <T.TooltipTrigger {...props} />;
}
export function TooltipContent(props: P) {
  const { isTvMode } = useTvMode();
  return isTvMode ? null : <T.TooltipContent {...props} />;
}
