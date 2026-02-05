import { memo, useEffect, useState, useRef } from "react";

interface DebugEvent {
  timestamp: string;
  source: string;
  event: string;
  details?: string;
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
  
  const frameCountRef = useRef(0);
  const lastFrameTimeRef = useRef(performance.now());
  const lastSonosTrackRef = useRef<string | null>(null);
  const mountTimeRef = useRef(Date.now());

  // FPS counter
  useEffect(() => {
    let animationId: number;
    
    const measureFps = () => {
      frameCountRef.current++;
      const now = performance.now();
      const elapsed = now - lastFrameTimeRef.current;
      
      if (elapsed >= 1000) {
        setFps(Math.round((frameCountRef.current * 1000) / elapsed));
        frameCountRef.current = 0;
        lastFrameTimeRef.current = now;
      }
      
      animationId = requestAnimationFrame(measureFps);
    };
    
    animationId = requestAnimationFrame(measureFps);
    return () => cancelAnimationFrame(animationId);
  }, []);

  // Memory monitor
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
    const interval = setInterval(updateMemory, 2000);
    return () => clearInterval(interval);
  }, []);

  // Track Sonos changes
  useEffect(() => {
    if (sonosTrack !== lastSonosTrackRef.current) {
      if (lastSonosTrackRef.current !== null) {
        addLog("SONOS", "TRACK_CHANGE", `${lastSonosTrackRef.current?.slice(0, 20)} → ${sonosTrack?.slice(0, 20)}`);
      }
      lastSonosTrackRef.current = sonosTrack ?? null;
    }
  }, [sonosTrack]);

  // Intercept Supabase realtime events
  useEffect(() => {
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    
    console.log = (...args) => {
      const msg = args.join(' ');
      if (msg.includes('postgres_changes') || msg.includes('realtime')) {
        setRealtimeEvents(prev => prev + 1);
        setLastRealtimeEvent(new Date().toLocaleTimeString('sv-SE'));
      }
      originalConsoleLog.apply(console, args);
    };
    
    console.error = (...args) => {
      const msg = args.join(' ');
      addLog("ERROR", "CONSOLE", msg.slice(0, 100));
      originalConsoleError.apply(console, args);
    };
    
    return () => {
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
    };
  }, []);

  const addLog = (source: string, event: string, details?: string) => {
    const now = new Date();
    const timestamp = `${now.toLocaleTimeString('sv-SE')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
    setLogs(prev => [...prev.slice(-14), { timestamp, source, event, details }]);
  };

  const uptime = Math.round((Date.now() - mountTimeRef.current) / 1000);

  return (
    <div 
      className="fixed top-4 left-4 z-50 p-4 rounded-lg text-xs font-mono select-none pointer-events-none"
      style={{
        background: 'rgba(0, 0, 0, 0.95)',
        color: '#0f0',
        width: '420px',
        maxHeight: '600px',
        overflow: 'auto',
        border: '1px solid #333',
      }}
    >
      <div className="font-bold mb-3 text-yellow-400 text-sm">🔧 Dashboard Debug</div>
      
      {/* Performance metrics */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <span className={fps < 30 ? 'text-red-400' : fps < 50 ? 'text-yellow-400' : 'text-green-400'}>
            FPS: {fps}
          </span>
        </div>
        <div>Uptime: {uptime}s</div>
        {memoryInfo && (
          <>
            <div className={memoryInfo.percent > 80 ? 'text-red-400' : memoryInfo.percent > 60 ? 'text-yellow-400' : ''}>
              Memory: {memoryInfo.usedMB}MB
            </div>
            <div className={memoryInfo.percent > 80 ? 'text-red-400' : ''}>
              ({memoryInfo.percent}% of {memoryInfo.totalMB}MB)
            </div>
          </>
        )}
      </div>

      {/* Data counts */}
      <div className="border-t border-gray-600 pt-2 mb-2">
        <div className="text-gray-400 mb-1">Data loaded:</div>
        <div className="grid grid-cols-3 gap-2">
          <div>Brews: {brewCount}</div>
          <div>Controllers: {controllerCount}</div>
          <div>Pills: {pillCount}</div>
        </div>
      </div>

      {/* Realtime stats */}
      <div className="border-t border-gray-600 pt-2 mb-2">
        <div className="text-gray-400 mb-1">Realtime:</div>
        <div>Events received: {realtimeEvents}</div>
        <div>Last event: {lastRealtimeEvent || 'none'}</div>
      </div>

      {/* Sonos state */}
      {sonosTrack && (
        <div className="border-t border-gray-600 pt-2 mb-2">
          <div className="text-cyan-400 mb-1">Sonos:</div>
          <div className="truncate">Track: {sonosTrack}</div>
          <div>Progress: {Math.round((sonosPosition ?? 0) / 1000)}s / {Math.round((sonosDuration ?? 0) / 1000)}s</div>
        </div>
      )}

      {/* Event log */}
      <div className="border-t border-gray-600 pt-2">
        <div className="text-yellow-400 mb-1">Event Log:</div>
        {logs.length === 0 ? (
          <div className="text-gray-500">No events yet...</div>
        ) : (
          logs.map((log, i) => (
            <div key={i} className="text-[10px] mb-1 flex gap-1">
              <span className="text-gray-500 w-20 flex-shrink-0">{log.timestamp}</span>
              <span className={
                log.source === 'ERROR' ? 'text-red-400' :
                log.source === 'SONOS' ? 'text-cyan-400' :
                log.source === 'REALTIME' ? 'text-purple-400' :
                'text-white'
              }>
                [{log.source}]
              </span>
              <span className="text-gray-300 truncate">{log.event} {log.details}</span>
            </div>
          ))
        )}
      </div>

      {/* Long task detection */}
      <LongTaskDetector onLongTask={(duration) => addLog("PERF", "LONG_TASK", `${duration}ms`)} />
    </div>
  );
});

// Detects long tasks (> 50ms) that cause jank
function LongTaskDetector({ onLongTask }: { onLongTask: (duration: number) => void }) {
  useEffect(() => {
    if (!('PerformanceObserver' in window)) return;
    
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration > 50) {
            onLongTask(Math.round(entry.duration));
          }
        }
      });
      
      observer.observe({ entryTypes: ['longtask'] });
      return () => observer.disconnect();
    } catch (e) {
      // longtask not supported in all browsers
      return;
    }
  }, [onLongTask]);
  
  return null;
}
