import { useState, useEffect, useRef, useCallback } from "react";
import { subscribeBleDebug, type BleDebugEntry } from "@/lib/phomemo-driver/connection";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PrintDebugOverlayProps {
  open: boolean;
  onClose: () => void;
}

export function PrintDebugOverlay({ open, onClose }: PrintDebugOverlayProps) {
  const [entries, setEntries] = useState<BleDebugEntry[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const clear = useCallback(() => {
    setEntries([]);
    setTotalBytes(0);
  }, []);

  useEffect(() => {
    if (!open) return;
    clear();
    const unsub = subscribeBleDebug((entry) => {
      setEntries(prev => {
        // Keep max 500 entries to avoid memory issues
        const next = prev.length >= 500 ? [...prev.slice(-400), entry] : [...prev, entry];
        return next;
      });
      setTotalBytes(prev => prev + entry.bytes);
    });
    return unsub;
  }, [open, clear]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] bg-background/95 backdrop-blur-sm flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-bold text-foreground">🔬 BLE Debug</h2>
          <span className="text-xs text-muted-foreground font-mono">
            {entries.length} cmd • {formatBytes(totalBytes)} skickat
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={clear} className="text-xs h-7">
            Rensa
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Log area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-0.5">
        {entries.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">
            Väntar på BLE-kommandon... Starta en utskrift.
          </p>
        )}
        {entries.map((e, i) => (
          <div
            key={i}
            className={`font-mono text-[11px] leading-relaxed flex gap-2 ${
              e.direction === 'in' ? 'text-green-400' : 'text-foreground/80'
            }`}
          >
            <span className="text-muted-foreground/50 w-16 shrink-0 text-right tabular-nums">
              {formatMs(e.ts)}
            </span>
            <span className={`shrink-0 w-5 text-center ${
              e.direction === 'in' ? 'text-green-500' : 'text-blue-400'
            }`}>
              {e.direction === 'out' ? '→' : '←'}
            </span>
            <span className="text-primary/70 w-24 shrink-0 truncate">{e.ctx}</span>
            <span className="text-muted-foreground/60 w-12 shrink-0 text-right tabular-nums">
              {e.bytes}B
            </span>
            <span className="text-foreground/60 break-all">{e.hex}</span>
          </div>
        ))}
      </div>

      {/* Summary bar */}
      <div className="px-4 py-2 border-t border-border text-[10px] text-muted-foreground/50 text-center">
        Visar alla BLE-skrivningar i realtid • Rasterdata visas trunkerat (32 bytes)
      </div>
    </div>
  );
}

function formatMs(ts: number): string {
  const s = (ts / 1000).toFixed(2);
  return `${s}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
