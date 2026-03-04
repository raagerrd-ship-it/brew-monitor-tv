import * as React from "react";
import { useAspectRatio } from "@/components/AspectRatioContainer";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  // When aspect ratio is locked (desktop preview), always treat as non-mobile
  // because layout is rendered at 1280×720 reference resolution
  let aspectRatio: { isLocked: boolean } = { isLocked: false };
  try {
    aspectRatio = useAspectRatio();
  } catch {
    // Context may not be available (e.g. outside provider)
  }

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  // Override: locked aspect ratio means we're rendering at 1280px width
  if (aspectRatio.isLocked) return false;

  return !!isMobile;
}
