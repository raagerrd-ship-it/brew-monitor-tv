import { memo, useEffect, useState, useRef } from "react";

interface DebugData {
  timestamp: string;
  event: string;
  details?: string;
}

interface SonosDebugOverlayProps {
  trackName: string | null;
  artistName: string | null;
  playbackState: string;
  positionMs: number | null;
  durationMs: number | null;
  imageLoaded: boolean;
  imageError: boolean;
}

export const SonosDebugOverlay = memo(function SonosDebugOverlay({
  trackName,
  artistName,
  playbackState,
  positionMs,
  durationMs,
  imageLoaded,
  imageError,
}: SonosDebugOverlayProps) {
  const [memoryInfo, setMemoryInfo] = useState<{ usedMB: number; totalMB: number; percent: number } | null>(null);
  const [logs, setLogs] = useState<DebugData[]>([]);
  const [renderCount, setRenderCount] = useState(0);
  const lastTrackRef = useRef<string | null>(null);
  const lastStateRef = useRef<string>("");
  const renderStartRef = useRef<number>(Date.now());

  // Track render count
  useEffect(() => {
    setRenderCount(prev => prev + 1);
  });

  // Log track changes
  useEffect(() => {
    if (trackName !== lastTrackRef.current) {
      const duration = Date.now() - renderStartRef.current;
      addLog("TRACK_CHANGE", `${lastTrackRef.current} → ${trackName} (${duration}ms since last render)`);
      lastTrackRef.current = trackName;
      renderStartRef.current = Date.now();
    }
  }, [trackName]);

  // Log playback state changes
  useEffect(() => {
    if (playbackState !== lastStateRef.current) {
      addLog("STATE_CHANGE", `${lastStateRef.current} → ${playbackState}`);
      lastStateRef.current = playbackState;
    }
  }, [playbackState]);

  // Log image load events
  useEffect(() => {
    if (imageLoaded) {
      addLog("IMAGE_LOADED", trackName ?? "unknown");
    }
  }, [imageLoaded, trackName]);

  useEffect(() => {
    if (imageError) {
      addLog("IMAGE_ERROR", trackName ?? "unknown");
    }
  }, [imageError, trackName]);

  // Monitor memory usage
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

  const addLog = (event: string, details?: string) => {
    const now = new Date();
    const timestamp = `${now.toLocaleTimeString('sv-SE')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
    setLogs(prev => [...prev.slice(-9), { timestamp, event, details }]);
  };

  const progressPercent = positionMs && durationMs 
    ? Math.round((positionMs / durationMs) * 100) 
    : 0;

  return (
    <div 
      className="fixed top-4 left-4 z-50 p-4 rounded-lg text-xs font-mono"
      style={{
        background: 'rgba(0, 0, 0, 0.9)',
        color: '#0f0',
        maxWidth: '400px',
        maxHeight: '500px',
        overflow: 'auto',
      }}
    >
      <div className="font-bold mb-2 text-yellow-400">🔧 Sonos Debug</div>
      
      {/* Memory */}
      {memoryInfo && (
        <div className="mb-2">
          <span className={memoryInfo.percent > 80 ? 'text-red-400' : memoryInfo.percent > 60 ? 'text-yellow-400' : ''}>
            Memory: {memoryInfo.usedMB}MB / {memoryInfo.totalMB}MB ({memoryInfo.percent}%)
          </span>
        </div>
      )}

      {/* Render count */}
      <div className="mb-2">
        Renders: {renderCount}
      </div>

      {/* Current state */}
      <div className="mb-2 border-t border-gray-600 pt-2">
        <div>Track: {trackName ?? 'null'}</div>
        <div>Artist: {artistName ?? 'null'}</div>
        <div>State: {playbackState}</div>
        <div>Progress: {positionMs ?? 0}ms / {durationMs ?? 0}ms ({progressPercent}%)</div>
        <div>Image: {imageLoaded ? '✅ loaded' : imageError ? '❌ error' : '⏳ loading'}</div>
      </div>

      {/* Event log */}
      <div className="border-t border-gray-600 pt-2">
        <div className="text-yellow-400 mb-1">Event Log:</div>
        {logs.length === 0 ? (
          <div className="text-gray-500">No events yet...</div>
        ) : (
          logs.map((log, i) => (
            <div key={i} className="text-[10px] mb-1">
              <span className="text-gray-400">{log.timestamp}</span>{' '}
              <span className={
                log.event === 'TRACK_CHANGE' ? 'text-cyan-400' :
                log.event === 'IMAGE_ERROR' ? 'text-red-400' :
                log.event === 'IMAGE_LOADED' ? 'text-green-400' :
                'text-white'
              }>
                {log.event}
              </span>
              {log.details && <span className="text-gray-300"> {log.details}</span>}
            </div>
          ))
        )}
      </div>
    </div>
  );
});
