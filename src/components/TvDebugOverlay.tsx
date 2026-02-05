import { memo, useEffect, useState, useRef } from "react";

/**
 * Minimal debug overlay for TV mode.
 * Updates every 5 seconds to minimize resource usage.
 * No PerformanceObserver, no console interception, no event logging.
 */
export const TvDebugOverlay = memo(function TvDebugOverlay() {
  const [memoryInfo, setMemoryInfo] = useState<{ usedMB: number; percent: number } | null>(null);
  const [fps, setFps] = useState<number>(0);
  const mountTimeRef = useRef(Date.now());
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;

  // FPS counter - measure for 1 second every 5 seconds
  useEffect(() => {
    let animationId: number | null = null;
    let frameCount = 0;
    let measureStartTime = 0;
    
    const startMeasurement = () => {
      frameCount = 0;
      measureStartTime = performance.now();
      
      const countFrames = () => {
        frameCount++;
        const elapsed = performance.now() - measureStartTime;
        
        if (elapsed < 1000) {
          animationId = requestAnimationFrame(countFrames);
        } else {
          setFps(Math.round((frameCount * 1000) / elapsed));
          animationId = null;
        }
      };
      
      animationId = requestAnimationFrame(countFrames);
    };
    
    startMeasurement();
    const interval = setInterval(startMeasurement, 5000);
    
    return () => {
      clearInterval(interval);
      if (animationId !== null) {
        cancelAnimationFrame(animationId);
      }
    };
  }, []);

  // Memory monitor - every 5 seconds
  useEffect(() => {
    const updateMemory = () => {
      const perf = performance as any;
      if (perf.memory) {
        const used = perf.memory.usedJSHeapSize / 1024 / 1024;
        const total = perf.memory.jsHeapSizeLimit / 1024 / 1024;
        setMemoryInfo({
          usedMB: Math.round(used),
          percent: Math.round((used / total) * 100),
        });
      }
    };

    updateMemory();
    const interval = setInterval(updateMemory, 5000);
    return () => clearInterval(interval);
  }, []);

  const uptime = Math.round((Date.now() - mountTimeRef.current) / 1000);

  const fpsColor = fps < 30 ? '#f87171' : fps < 50 ? '#fbbf24' : '#4ade80';
  const memColor = memoryInfo && memoryInfo.percent > 80 ? '#f87171' : memoryInfo && memoryInfo.percent > 60 ? '#fbbf24' : '#4ade80';

  return (
    <div 
      className="fixed top-4 left-4 z-50 px-3 py-2 rounded-lg text-xs font-mono select-none pointer-events-none"
      style={{
        background: 'rgba(0, 0, 0, 0.85)',
        border: '1px solid #333',
      }}
    >
      <div className="flex items-center gap-4">
        <span style={{ color: fpsColor }}>FPS: {fps}</span>
        {memoryInfo && (
          <span style={{ color: memColor }}>Mem: {memoryInfo.usedMB}MB ({memoryInfo.percent}%)</span>
        )}
        <span style={{ color: '#9ca3af' }}>Up: {uptime}s</span>
        <span style={{ color: '#9ca3af' }}>R: {renderCountRef.current}</span>
      </div>
    </div>
  );
});
