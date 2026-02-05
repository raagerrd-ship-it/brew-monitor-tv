import { memo, useEffect, useState, useRef, useCallback } from "react";

interface DebugEvent {
  timestamp: string;
  source: string;
  event: string;
  details?: string;
}

interface LongTaskEntry {
  duration: number;
  source: string;
  time: string;
}

interface ManualTiming {
  name: string;
  duration: number;
  time: string;
}

interface LongTaskStats {
  count: number;
  totalDuration: number;
  maxDuration: number;
  lastSeen: string | null;
  recentTasks: LongTaskEntry[];
}

// Global timing registry for manual instrumentation
declare global {
  interface Window {
    __perfTimings: ManualTiming[];
    __perfMark: (name: string) => void;
    __perfMeasure: (name: string, startMark: string) => void;
  }
}

// Initialize global debug functions - call these in suspected heavy code
if (typeof window !== 'undefined' && !window.__perfTimings) {
  window.__perfTimings = [];
  window.__perfMark = (name: string) => {
    performance.mark(name);
  };
  window.__perfMeasure = (name: string, startMark: string) => {
    try {
      performance.measure(name, startMark);
      const entries = performance.getEntriesByName(name, 'measure');
      if (entries.length > 0) {
        const entry = entries[entries.length - 1];
        if (entry.duration > 16) { // Only log if > 1 frame (16ms)
          window.__perfTimings.push({
            name,
            duration: Math.round(entry.duration),
            time: new Date().toLocaleTimeString('sv-SE'),
          });
          // Keep only last 20
          if (window.__perfTimings.length > 20) {
            window.__perfTimings.shift();
          }
          console.log(`⏱️ [PERF] ${name}: ${Math.round(entry.duration)}ms`);
        }
      }
      performance.clearMarks(startMark);
      performance.clearMeasures(name);
    } catch (e) {
      // Ignore errors from missing marks
    }
  };
}

interface DashboardDebugOverlayProps {
  brewCount: number;
  controllerCount: number;
  pillCount: number;
  // Sonos data
  sonosTrack?: string | null;
  sonosPosition?: number | null;
  sonosDuration?: number | null;
}

export const DashboardDebugOverlay = memo(function DashboardDebugOverlay({
  brewCount,
  controllerCount,
  pillCount,
  sonosTrack,
  sonosPosition,
  sonosDuration,
}: DashboardDebugOverlayProps) {
  const [memoryInfo, setMemoryInfo] = useState<{ usedMB: number; totalMB: number; percent: number } | null>(null);
  const [fps, setFps] = useState<number>(0);
  const [logs, setLogs] = useState<DebugEvent[]>([]);
  const [manualTimings, setManualTimings] = useState<ManualTiming[]>([]);
  const [longTaskStats, setLongTaskStats] = useState<LongTaskStats>({
    count: 0,
    totalDuration: 0,
    maxDuration: 0,
    lastSeen: null,
    recentTasks: [],
  });
  
  const frameCountRef = useRef(0);
  const lastFrameTimeRef = useRef(performance.now());
  const lastSonosTrackRef = useRef<string | null>(null);
  const mountTimeRef = useRef(Date.now());
  const longTaskThrottleRef = useRef<number>(0);

  // Track renders via ref (not state to avoid triggering re-renders)
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;

  // FPS counter - measure for 1 second every 5 seconds to save resources
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
        
        // Measure for 1 second, then stop
        if (elapsed < 1000) {
          animationId = requestAnimationFrame(countFrames);
        } else {
          setFps(Math.round((frameCount * 1000) / elapsed));
          animationId = null;
        }
      };
      
      animationId = requestAnimationFrame(countFrames);
    };
    
    // Start first measurement immediately
    startMeasurement();
    
    // Then measure every 5 seconds
    const interval = setInterval(startMeasurement, 5000);
    
    return () => {
      clearInterval(interval);
      if (animationId !== null) {
        cancelAnimationFrame(animationId);
      }
    };
  }, []);

  // Memory monitor - less frequent
  useEffect(() => {
    const updateMemory = () => {
      const perf = performance as any;
      if (perf.memory) {
        const used = perf.memory.usedJSHeapSize / 1024 / 1024;
        const total = perf.memory.jsHeapSizeLimit / 1024 / 1024;
        setMemoryInfo({
          usedMB: Math.round(used),
          totalMB: Math.round(total),
          percent: Math.round((used / total) * 100),
        });
      }
    };

    updateMemory();
    const interval = setInterval(updateMemory, 5000);
    return () => clearInterval(interval);
  }, []);

  // addLog callback - must be before useEffects that use it
  const addLog = useCallback((source: string, event: string, details?: string) => {
    const now = new Date();
    const timestamp = `${now.toLocaleTimeString('sv-SE')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
    setLogs(prev => [...prev.slice(-9), { timestamp, source, event, details }]);
  }, []);

  useEffect(() => {
    if (sonosTrack !== lastSonosTrackRef.current) {
      if (lastSonosTrackRef.current !== null) {
        addLog("SONOS", "TRACK_CHANGE", `→ ${sonosTrack?.slice(0, 30)}`);
      }
      lastSonosTrackRef.current = sonosTrack ?? null;
    }
  }, [sonosTrack, addLog]);

  // Long task detector
  useEffect(() => {
    if (!('PerformanceObserver' in window)) return;
    
    try {
      const observer = new PerformanceObserver((list) => {
        const now = Date.now();
        
        for (const entry of list.getEntries()) {
          if (entry.duration > 50) {
            const duration = Math.round(entry.duration);
            const time = new Date().toLocaleTimeString('sv-SE');
            
            // Long Task API has limited attribution on most devices
            const taskEntry: LongTaskEntry = { 
              duration, 
              source: 'main-thread', 
              time 
            };
            
            setLongTaskStats(prev => ({
              count: prev.count + 1,
              totalDuration: prev.totalDuration + duration,
              maxDuration: Math.max(prev.maxDuration, duration),
              lastSeen: time,
              recentTasks: [...prev.recentTasks.slice(-9), taskEntry],
            }));
            
            // Log significant tasks
            if (duration > 100 || now - longTaskThrottleRef.current > 2000) {
              longTaskThrottleRef.current = now;
              addLog("PERF", `LONG_TASK ${duration}ms`, '');
            }
          }
        }
      });
      
      observer.observe({ entryTypes: ['longtask'] });
      return () => observer.disconnect();
    } catch (e) {
      return;
    }
  }, [addLog]);

  // Intercept console.error
  useEffect(() => {
    const originalConsoleError = console.error;
    
    console.error = (...args) => {
      const msg = args.join(' ');
      addLog("ERROR", "CONSOLE", msg.slice(0, 80));
      originalConsoleError.apply(console, args);
    };
    
    return () => {
      console.error = originalConsoleError;
    };
  }, [addLog]);

  // Poll manual timings from global registry - every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (window.__perfTimings && window.__perfTimings.length > 0) {
        setManualTimings([...window.__perfTimings]);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const uptime = Math.round((Date.now() - mountTimeRef.current) / 1000);
  const avgLongTask = longTaskStats.count > 0 
    ? Math.round(longTaskStats.totalDuration / longTaskStats.count) 
    : 0;

  return (
    <div 
      className="fixed top-4 left-4 z-50 p-3 rounded-lg text-xs font-mono select-none pointer-events-none"
      style={{
        background: 'rgba(0, 0, 0, 0.92)',
        color: '#0f0',
        width: '340px',
        maxHeight: '450px',
        overflow: 'auto',
        border: '1px solid #333',
      }}
    >
      <div className="font-bold mb-2 text-yellow-400 text-sm">🔧 Debug Overlay</div>
      
      {/* Performance metrics row */}
      <div className="grid grid-cols-4 gap-2 mb-2 text-[11px]">
        <div className={fps < 30 ? 'text-red-400' : fps < 50 ? 'text-yellow-400' : 'text-green-400'}>
          FPS: {fps}
        </div>
        <div>Up: {uptime}s</div>
        <div>Renders: {renderCountRef.current}</div>
        {memoryInfo && (
          <div className={memoryInfo.percent > 80 ? 'text-red-400' : memoryInfo.percent > 60 ? 'text-yellow-400' : ''}>
            Mem: {memoryInfo.percent}%
          </div>
        )}
      </div>

      {/* Long Task Stats */}
      <div className={`border rounded p-2 mb-2 ${longTaskStats.count > 10 ? 'border-red-500 bg-red-900/20' : 'border-gray-600'}`}>
        <div className="text-yellow-400 mb-1 font-semibold">⚠️ Long Tasks (&gt;50ms)</div>
        <div className="grid grid-cols-2 gap-1 text-[11px]">
          <div>Count: <span className={longTaskStats.count > 20 ? 'text-red-400' : ''}>{longTaskStats.count}</span></div>
          <div>Max: <span className={longTaskStats.maxDuration > 100 ? 'text-red-400' : ''}>{longTaskStats.maxDuration}ms</span></div>
          <div>Avg: {avgLongTask}ms</div>
          <div>Last: {longTaskStats.lastSeen || '-'}</div>
        </div>
        
        {longTaskStats.count > 20 && (
          <div className="text-red-400 text-[10px] mt-1">
            ⚠️ Många long tasks = något blockerar huvudtråden
          </div>
        )}
      </div>

      {/* Manual performance timings - shows specific tracked operations */}
      {manualTimings.length > 0 && (
        <div className="border border-cyan-600 rounded p-2 mb-2 bg-cyan-900/10">
          <div className="text-cyan-400 mb-1 font-semibold text-[11px]">⏱️ Spårade operationer</div>
          {manualTimings.slice(-5).reverse().map((t, i) => (
            <div key={i} className="text-[10px] flex gap-2">
              <span className={t.duration > 100 ? 'text-red-400' : t.duration > 50 ? 'text-orange-400' : 'text-green-400'}>
                {t.duration}ms
              </span>
              <span className="text-white">{t.name}</span>
              <span className="text-gray-500">{t.time}</span>
            </div>
          ))}
        </div>
      )}

      {/* Data counts */}
      <div className="grid grid-cols-3 gap-2 text-[11px] mb-2">
        <div>Brews: {brewCount}</div>
        <div>Ctrl: {controllerCount}</div>
        <div>Pills: {pillCount}</div>
      </div>

      {/* Sonos state */}
      {sonosTrack && (
        <div className="border-t border-gray-600 pt-1 mb-2 text-[11px]">
          <span className="text-cyan-400">♪</span> {sonosTrack.slice(0, 35)}
        </div>
      )}

      {/* Event log */}
      <div className="border-t border-gray-600 pt-1">
        <div className="text-gray-400 mb-1 text-[10px]">Recent Events:</div>
        {logs.length === 0 ? (
          <div className="text-gray-500 text-[10px]">No events...</div>
        ) : (
          logs.slice(-6).map((log, i) => (
            <div key={i} className="text-[9px] mb-0.5 flex gap-1">
              <span className="text-gray-500 w-16 flex-shrink-0">{log.timestamp.split('.')[0]}</span>
              <span className={
                log.source === 'ERROR' ? 'text-red-400' :
                log.source === 'SONOS' ? 'text-cyan-400' :
                log.source === 'PERF' ? 'text-orange-400' :
                'text-white'
              }>
                [{log.source}]
              </span>
              <span className="text-gray-300 truncate">{log.event} {log.details}</span>
            </div>
          ))
        )}
      </div>

      {/* Instructions */}
      <div className="border-t border-gray-700 mt-2 pt-2 text-[9px] text-gray-500">
        <div>Manuell spårning i kod:</div>
        <div className="text-gray-400 font-mono">__perfMark('start_X')</div>
        <div className="text-gray-400 font-mono">__perfMeasure('X', 'start_X')</div>
      </div>
    </div>
  );
});
