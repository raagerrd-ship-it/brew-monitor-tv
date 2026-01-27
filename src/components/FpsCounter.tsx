import { memo, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * FPS Counter component for performance monitoring.
 * Enable by adding ?fps=true to the URL.
 */
export const FpsCounter = memo(function FpsCounter() {
  const [searchParams] = useSearchParams();
  const [fps, setFps] = useState(0);
  const [avgFps, setAvgFps] = useState(0);
  const [minFps, setMinFps] = useState(999);
  const frameTimesRef = useRef<number[]>([]);
  const lastFrameTimeRef = useRef(performance.now());
  const rafIdRef = useRef<number>(0);

  // TEMP: Always show for testing - revert to: searchParams.get('fps') === 'true'
  const showFps = true;

  useEffect(() => {
    if (!showFps) return;

    const measureFps = () => {
      const now = performance.now();
      const delta = now - lastFrameTimeRef.current;
      lastFrameTimeRef.current = now;

      // Calculate current FPS
      const currentFps = delta > 0 ? Math.round(1000 / delta) : 0;

      // Keep last 60 frame times for average
      frameTimesRef.current.push(currentFps);
      if (frameTimesRef.current.length > 60) {
        frameTimesRef.current.shift();
      }

      // Calculate average
      const avg = Math.round(
        frameTimesRef.current.reduce((a, b) => a + b, 0) / frameTimesRef.current.length
      );

      // Track minimum (reset every 5 seconds)
      const min = Math.min(...frameTimesRef.current);

      setFps(currentFps);
      setAvgFps(avg);
      setMinFps(min);

      rafIdRef.current = requestAnimationFrame(measureFps);
    };

    rafIdRef.current = requestAnimationFrame(measureFps);

    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [showFps]);

  if (!showFps) return null;

  // Color based on FPS performance
  const getFpsColor = (value: number) => {
    if (value >= 50) return 'text-green-400';
    if (value >= 30) return 'text-yellow-400';
    if (value >= 15) return 'text-orange-400';
    return 'text-red-400';
  };

  return (
    <div 
      className="fixed top-2 left-2 z-[9999] bg-black/80 backdrop-blur-sm rounded-lg px-3 py-2 font-mono text-xs shadow-lg border border-white/10"
      style={{ pointerEvents: 'none' }}
    >
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="text-white/60">FPS:</span>
          <span className={`font-bold ${getFpsColor(fps)}`}>{fps}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-white/60">AVG:</span>
          <span className={`font-bold ${getFpsColor(avgFps)}`}>{avgFps}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-white/60">MIN:</span>
          <span className={`font-bold ${getFpsColor(minFps)}`}>{minFps}</span>
        </div>
      </div>
    </div>
  );
});
