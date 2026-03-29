import { useState, useEffect, useRef, useCallback } from "react";
import { subscribeBleDebug, type BleDebugEntry } from "@/lib/phomemo-driver/connection";
import { X, Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

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
        const next = prev.length >= 2000 ? [...prev.slice(-1500), entry] : [...prev, entry];
        return next;
      });
      setTotalBytes(prev => prev + entry.bytes);
    });
    return unsub;
  }, [open, clear]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  const buildLogText = useCallback(() => {
    return entries.map(e => {
      const dir = e.direction === 'out' ? 'TX' : 'RX';
      const ts = (e.ts / 1000).toFixed(3);
      return `${ts}s ${dir} [${e.ctx}] ${e.bytes}B ${e.hex}`;
    }).join('\n');
  }, [entries]);

  const handleCopy = async () => {
    const text = buildLogText();
    await navigator.clipboard.writeText(text);
    toast({ title: "Kopierat!", description: `${entries.length} rader kopierade till urklipp.` });
  };

  const handleDownload = () => {
    const text = buildLogText();
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ble-print-log-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] bg-background/95 backdrop-blur-sm flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-bold text-foreground">🔬 BLE Debug</h2>
          <span className="text-xs text-muted-foreground font-mono">
            {entries.length} cmd • {formatBytes(totalBytes)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={handleCopy} className="text-xs h-7 gap-1" disabled={entries.length === 0}>
            <Copy className="h-3 w-3" /> Kopiera
          </Button>
          <Button variant="ghost" size="sm" onClick={handleDownload} className="text-xs h-7 gap-1" disabled={entries.length === 0}>
            <Download className="h-3 w-3" /> Ladda ner
          </Button>
          <Button variant="ghost" size="sm" onClick={clear} className="text-xs h-7">
            Rensa
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

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
              {(e.ts / 1000).toFixed(2)}s
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

      <div className="px-4 py-2 border-t border-border text-[10px] text-muted-foreground/50 text-center">
        TX = skickat till skrivare • RX = svar från skrivare • Rasterdata trunkerat till 32 bytes hex
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
