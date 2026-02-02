import { ReactNode, useEffect, useState, createContext, useContext } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTvMode } from "@/contexts/TvModeContext";

// Reference resolution - layout is designed for this size
const REFERENCE_WIDTH = 1920;
const REFERENCE_HEIGHT = 1080;

// Context to signal children that they're inside an aspect ratio container
interface AspectRatioContextType {
  isLocked: boolean;
  width: number;
  height: number;
  scale: number;
}

const AspectRatioContext = createContext<AspectRatioContextType>({
  isLocked: false,
  width: REFERENCE_WIDTH,
  height: REFERENCE_HEIGHT,
  scale: 1,
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
  const [dimensions, setDimensions] = useState({ width: 0, height: 0, scale: 1 });

  // Only lock aspect ratio for TV mode OR desktop (not mobile)
  const shouldLockAspectRatio = isTvMode || !isMobile;

  useEffect(() => {
    if (!shouldLockAspectRatio) return;

    const calculateDimensions = () => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let containerWidth: number;
      let containerHeight: number;

      if (viewportWidth / viewportHeight > aspectRatio) {
        // Viewport is too wide → use height as base (pillarboxing)
        containerHeight = viewportHeight;
        containerWidth = containerHeight * aspectRatio;
      } else {
        // Viewport is too tall → use width as base (letterboxing)
        containerWidth = viewportWidth;
        containerHeight = containerWidth / aspectRatio;
      }

      // Calculate scale factor based on reference resolution
      const scaleX = containerWidth / REFERENCE_WIDTH;
      const scaleY = containerHeight / REFERENCE_HEIGHT;
      const scale = Math.min(scaleX, scaleY);

      setDimensions({ 
        width: containerWidth, 
        height: containerHeight, 
        scale 
      });
    };

    calculateDimensions();

    window.addEventListener("resize", calculateDimensions);
    return () => window.removeEventListener("resize", calculateDimensions);
  }, [shouldLockAspectRatio, aspectRatio]);

  // Mobile: render children without aspect ratio lock
  if (!shouldLockAspectRatio) {
    return (
      <AspectRatioContext.Provider value={{ isLocked: false, width: REFERENCE_WIDTH, height: REFERENCE_HEIGHT, scale: 1 }}>
        {children}
      </AspectRatioContext.Provider>
    );
  }

  return (
    <AspectRatioContext.Provider value={{ 
      isLocked: true, 
      width: REFERENCE_WIDTH, 
      height: REFERENCE_HEIGHT,
      scale: dimensions.scale 
    }}>
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div
          style={{
            width: dimensions.width,
            height: dimensions.height,
          }}
          className="relative bg-background overflow-hidden"
        >
          {/* Scaled content container */}
          <div
            style={{
              width: REFERENCE_WIDTH,
              height: REFERENCE_HEIGHT,
              transform: `scale(${dimensions.scale})`,
              transformOrigin: 'top left',
            }}
            className="flex flex-col"
          >
            {children}
          </div>
        </div>
      </div>
    </AspectRatioContext.Provider>
  );
}
