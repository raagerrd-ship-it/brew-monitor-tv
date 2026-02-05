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

interface LongTaskStats {
  count: number;
  totalDuration: number;
  maxDuration: number;
  lastSeen: string | null;
  recentTasks: LongTaskEntry[];
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
  const [realtimeEvents, setRealtimeEvents] = useState<number>(0);
  const [lastRealtimeEvent, setLastRealtimeEvent] = useState<string | null>(null);
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

  // FPS counter - throttled to reduce overhead
  useEffect(() => {
    let animationId: number;
    let lastUpdate = performance.now();
    
    const measureFps = () => {
      frameCountRef.current++;
      const now = performance.now();
      
      // Only update state every second to reduce re-renders
      if (now - lastUpdate >= 1000) {
        const elapsed = now - lastFrameTimeRef.current;
        setFps(Math.round((frameCountRef.current * 1000) / elapsed));
        frameCountRef.current = 0;
        lastFrameTimeRef.current = now;
        lastUpdate = now;
      }
      
      animationId = requestAnimationFrame(measureFps);
    };
    
    animationId = requestAnimationFrame(measureFps);
    return () => cancelAnimationFrame(animationId);
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
    const interval = setInterval(updateMemory, 5000); // Every 5s instead of 2s
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
  }, [sonosTrack]);

  // Long task detector with detailed attribution
  useEffect(() => {
    if (!('PerformanceObserver' in window)) return;
    
    try {
      const observer = new PerformanceObserver((list) => {
        const now = Date.now();
        
        for (const entry of list.getEntries()) {
          if (entry.duration > 50) {
            const duration = Math.round(entry.duration);
            const time = new Date().toLocaleTimeString('sv-SE');
            
            // Try to get detailed attribution
            const attribution = (entry as any).attribution;
            let source = 'unknown';
            let details: string[] = [];
            
            if (attribution && attribution.length > 0) {
              for (const attr of attribution) {
                if (attr.containerType) details.push(`type:${attr.containerType}`);
                if (attr.containerName) details.push(`name:${attr.containerName}`);
                if (attr.containerSrc) {
                  // Extract just the filename from the full URL
                  const srcMatch = attr.containerSrc.match(/\/([^\/]+)$/);
                  if (srcMatch) details.push(`src:${srcMatch[1]}`);
                }
                if (attr.name) details.push(attr.name);
              }
              source = details.length > 0 ? details.join(' ') : attribution[0]?.containerType || 'script';
            }
            
            // Also check for any running frames/scripts via PerformanceEntry name
            if (entry.name && entry.name !== 'self') {
              source = entry.name;
            }
            
            const taskEntry: LongTaskEntry = { duration, source, time };
            
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
              addLog("PERF", `LONG_TASK ${duration}ms`, source);
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

  // Intercept realtime events only (removed console interception - it causes overhead)
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
        width: '380px',
        maxHeight: '500px',
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

      {/* Long Task Stats - this is the key diagnostic */}
      <div className={`border rounded p-2 mb-2 ${longTaskStats.count > 10 ? 'border-red-500 bg-red-900/20' : 'border-gray-600'}`}>
        <div className="text-yellow-400 mb-1 font-semibold">⚠️ Long Tasks (&gt;50ms)</div>
        <div className="grid grid-cols-2 gap-1 text-[11px]">
          <div>Count: <span className={longTaskStats.count > 20 ? 'text-red-400' : ''}>{longTaskStats.count}</span></div>
          <div>Max: <span className={longTaskStats.maxDuration > 100 ? 'text-red-400' : ''}>{longTaskStats.maxDuration}ms</span></div>
          <div>Avg: {avgLongTask}ms</div>
          <div>Last: {longTaskStats.lastSeen || '-'}</div>
        </div>
        
        {/* Recent long tasks with sources */}
        {longTaskStats.recentTasks.length > 0 && (
          <div className="mt-2 border-t border-gray-700 pt-1">
            <div className="text-[10px] text-gray-400 mb-1">Recent tasks (newest first):</div>
            {longTaskStats.recentTasks.slice().reverse().slice(0, 5).map((task, i) => (
              <div key={i} className="text-[9px] mb-0.5 flex gap-1">
                <span className={task.duration > 200 ? 'text-red-400' : task.duration > 100 ? 'text-orange-400' : 'text-yellow-400'}>
                  {task.duration}ms
                </span>
                <span className="text-gray-400">{task.time.split(':').slice(1).join(':')}</span>
                <span className="text-white truncate flex-1">{task.source}</span>
              </div>
            ))}
          </div>
        )}
        
        {longTaskStats.count > 20 && (
          <div className="text-red-400 text-[10px] mt-1">
            ⚠️ Många long tasks = något blockerar huvudtråden
          </div>
        )}
      </div>

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

      {/* Event log - reduced size */}
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
    </div>
  );
});
