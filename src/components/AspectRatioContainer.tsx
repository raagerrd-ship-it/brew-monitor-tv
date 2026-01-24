import { ReactNode, useEffect, useState, createContext, useContext } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTvMode } from "@/contexts/TvModeContext";

// Context to signal children that they're inside an aspect ratio container
interface AspectRatioContextType {
  isLocked: boolean;
  width: number;
  height: number;
}

const AspectRatioContext = createContext<AspectRatioContextType>({
  isLocked: false,
  width: 0,
  height: 0,
});

export function useAspectRatio() {
  return useContext(AspectRatioContext);
}

interface AspectRatioContainerProps {
  children: ReactNode;
  aspectRatio?: number;
}

export function AspectRatioContainer({ 
  children, 
  aspectRatio = 16 / 9 
}: AspectRatioContainerProps) {
  const isMobile = useIsMobile();
  const { isTvMode } = useTvMode();
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // Only lock aspect ratio for TV mode OR desktop (not mobile)
  const shouldLockAspectRatio = isTvMode || !isMobile;

  useEffect(() => {
    if (!shouldLockAspectRatio) return;

    const calculateDimensions = () => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let width: number;
      let height: number;

      if (viewportWidth / viewportHeight > aspectRatio) {
        // Viewport is too wide → use height as base (pillarboxing)
        height = viewportHeight;
        width = height * aspectRatio;
      } else {
        // Viewport is too tall → use width as base (letterboxing)
        width = viewportWidth;
        height = width / aspectRatio;
      }

      setDimensions({ width, height });
    };

    calculateDimensions();

    window.addEventListener("resize", calculateDimensions);
    return () => window.removeEventListener("resize", calculateDimensions);
  }, [shouldLockAspectRatio, aspectRatio]);

  // Mobile: render children without aspect ratio lock
  if (!shouldLockAspectRatio) {
    return (
      <AspectRatioContext.Provider value={{ isLocked: false, width: 0, height: 0 }}>
        {children}
      </AspectRatioContext.Provider>
    );
  }

  return (
    <AspectRatioContext.Provider value={{ isLocked: true, width: dimensions.width, height: dimensions.height }}>
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div
          style={{
            width: dimensions.width,
            height: dimensions.height,
          }}
          className="relative bg-background flex flex-col"
        >
          <div className="flex-1 overflow-y-auto">
            {children}
          </div>
        </div>
      </div>
    </AspectRatioContext.Provider>
  );
}
