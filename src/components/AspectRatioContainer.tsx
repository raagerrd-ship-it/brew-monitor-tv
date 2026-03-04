import { ReactNode, useEffect, useState, createContext, useContext } from "react";
import { useIsMobile } from "@/hooks";
import { useTvMode } from "@/contexts/TvModeContext";

// Reference resolution - layout is designed for 720p TV
const REFERENCE_WIDTH = 1280;
const REFERENCE_HEIGHT = 720;

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
  const [tvDimensions, setTvDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });

  // Desktop needs scaling for preview, TV and mobile don't
  const needsScaling = !isTvMode && !isMobile;

  // TV mode: track actual viewport size
  useEffect(() => {
    if (!isTvMode) return;

    const updateTvDimensions = () => {
      setTvDimensions({ width: window.innerWidth, height: window.innerHeight });
    };

    updateTvDimensions();
    window.addEventListener("resize", updateTvDimensions);
    return () => window.removeEventListener("resize", updateTvDimensions);
  }, [isTvMode]);

  // Desktop: calculate uniform scale to fit 1280×720 in viewport
  useEffect(() => {
    if (!needsScaling) return;

    const calculateDimensions = () => {
      const scale = Math.min(
        window.innerWidth / REFERENCE_WIDTH,
        window.innerHeight / REFERENCE_HEIGHT
      );
      setDimensions({ width: REFERENCE_WIDTH, height: REFERENCE_HEIGHT, scale });
    };

    calculateDimensions();
    window.addEventListener("resize", calculateDimensions);
    return () => window.removeEventListener("resize", calculateDimensions);
  }, [needsScaling, aspectRatio]);

  // Mobile: render children without aspect ratio lock
  if (isMobile) {
    return (
      <AspectRatioContext.Provider value={{ isLocked: false, width: REFERENCE_WIDTH, height: REFERENCE_HEIGHT, scale: 1 }}>
        {children}
      </AspectRatioContext.Provider>
    );
  }

  // TV mode: fullscreen, no aspect ratio lock
  if (isTvMode) {
    return (
      <AspectRatioContext.Provider value={{ 
        isLocked: true, 
        width: tvDimensions.width,
        height: tvDimensions.height,
        scale: 1
      }}>
        <div 
          className="fixed inset-0 overflow-hidden flex flex-col"
          style={{ background: 'transparent' }}
        >
          {children}
        </div>
      </AspectRatioContext.Provider>
    );
  }

  // Desktop: render at reference resolution and scale uniformly (like a static image)
  return (
    <AspectRatioContext.Provider value={{ 
      isLocked: true, 
      width: REFERENCE_WIDTH,
      height: REFERENCE_HEIGHT,
      scale: dimensions.scale
    }}>
      <div className="fixed inset-0 flex items-center justify-center bg-black overflow-hidden">
        <div 
          className="overflow-hidden flex flex-col"
          style={{ 
            width: REFERENCE_WIDTH, 
            height: REFERENCE_HEIGHT,
            transform: `scale(${dimensions.scale})`,
            transformOrigin: 'center center',
            background: 'transparent'
          }}
        >
          {children}
        </div>
      </div>
    </AspectRatioContext.Provider>
  );
}
