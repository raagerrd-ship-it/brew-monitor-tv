import { useState, useRef, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Download, Printer, FileText, Bluetooth, BluetoothOff, Loader2, Settings2 } from "lucide-react";
import { BrewData } from "@/types/brew";
import { renderTankLabel, renderKegLabel } from "./LabelCanvas";
import { toast } from "@/hooks/use-toast";
import {
  isBluetoothSupported,
  connectPrinter,
  reconnectLastPrinter,
  getLastDeviceName,
  disconnectPrinter,
  printBitmap,
  PRINTER_VERSION,
  DEFAULT_PRINT_SETTINGS,
  type PrinterConnection,
  type PrintProgress,
  type PrintSettings,
} from "@/lib/thermal-printer";

/** Trim white pixels from canvas edges, keeping a small margin */
function trimCanvas(source: HTMLCanvasElement, margin = 4): HTMLCanvasElement {
  const w = source.width, h = source.height;
  const ctx = source.getContext('2d')!;
  const data = ctx.getImageData(0, 0, w, h).data;
  const isWhite = (i: number) => data[i] > 250 && data[i+1] > 250 && data[i+2] > 250;

  let top = 0, bottom = h - 1, left = 0, right = w - 1;
  findTop: for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!isWhite((y * w + x) * 4)) { top = y; break findTop; }
  findBtm: for (let y = h - 1; y >= top; y--) for (let x = 0; x < w; x++) if (!isWhite((y * w + x) * 4)) { bottom = y; break findBtm; }
  findLft: for (let x = 0; x < w; x++) for (let y = top; y <= bottom; y++) if (!isWhite((y * w + x) * 4)) { left = x; break findLft; }
  findRgt: for (let x = w - 1; x >= left; x--) for (let y = top; y <= bottom; y++) if (!isWhite((y * w + x) * 4)) { right = x; break findRgt; }

  const t = Math.max(0, top - margin), l = Math.max(0, left - margin);
  const b = Math.min(h - 1, bottom + margin), r = Math.min(w - 1, right + margin);
  const tw = r - l + 1, th = b - t + 1;

  const out = document.createElement('canvas');
  out.width = tw; out.height = th;
  out.getContext('2d')!.drawImage(source, l, t, tw, th, 0, 0, tw, th);
  return out;
}

type LabelType = 'tank' | 'keg';
interface PrintLabelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brew: BrewData;
}

export function PrintLabelDialog({ open, onOpenChange, brew }: PrintLabelDialogProps) {
  const [labelType, setLabelType] = useState<LabelType>('tank');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copies, setCopies] = useState(1);
  const [bleConn, setBleConn] = useState<PrinterConnection | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [printProgress, setPrintProgress] = useState<PrintProgress | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [printSettings, setPrintSettings] = useState<PrintSettings>(() => {
    try {
      const saved = localStorage.getItem('phomemo-print-settings');
      return saved ? { ...DEFAULT_PRINT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_PRINT_SETTINGS;
    } catch { return DEFAULT_PRINT_SETTINGS; }
  });
  
  const hasBle = isBluetoothSupported();

  // Persist settings
  const updateSettings = (patch: Partial<PrintSettings>) => {
    setPrintSettings(prev => {
      const next = { ...prev, ...patch };
      localStorage.setItem('phomemo-print-settings', JSON.stringify(next));
      return next;
    });
  };

  // Render label preview whenever type or brew changes
  const renderPreview = useCallback(async () => {
    if (!canvasRef.current) return;
    const opts = { brew, canvas: canvasRef.current };
    if (labelType === 'tank') {
      await renderTankLabel(opts);
    } else {
      await renderKegLabel(opts);
    }
  }, [brew, labelType]);

  useEffect(() => {
    if (open) {
      const t = setTimeout(renderPreview, 50);
      return () => clearTimeout(t);
    }
  }, [open, renderPreview]);

  // Auto-reconnect to last printer when dialog opens
  useEffect(() => {
    if (!open || bleConn || !hasBle) return;

    const lastDevice = getLastDeviceName();
    if (!lastDevice) return;

    let cancelled = false;
    setIsConnecting(true);

    reconnectLastPrinter()
      .then((conn) => {
        if (cancelled) {
          if (conn) disconnectPrinter(conn);
          return;
        }
        if (conn) {
          setBleConn(conn);
          toast({ title: "Återansluten", description: `Ansluten till ${conn.device.name || 'skrivare'}` });
        }
      })
      .catch(() => { /* silent – user can connect manually */ })
      .finally(() => {
        if (!cancelled) setIsConnecting(false);
      });

    return () => { cancelled = true; };
  }, [open, hasBle]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up BLE connection on unmount
  useEffect(() => {
    return () => {
      if (bleConn) disconnectPrinter(bleConn);
    };
  }, [bleConn]);

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const conn = await connectPrinter();
      setBleConn(conn);
      toast({ title: "Ansluten", description: `Ansluten till ${conn.device.name || 'skrivare'}` });
    } catch (e: any) {
      if (e?.message?.includes('cancelled') || e?.name === 'NotFoundError') return;
      toast({ title: "Anslutningsfel", description: e.message, variant: "destructive" });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    if (bleConn) {
      disconnectPrinter(bleConn);
      setBleConn(null);
      toast({ title: "Frånkopplad", description: "Skrivaren har kopplats från." });
    }
  };

  const handleBlePrint = async () => {
    if (!canvasRef.current) return;
    setIsPrinting(true);
    setPrintProgress({ phase: 'Startar...', percent: 0 });
    try {
      // Auto-connect if not connected
      let conn = bleConn;
      if (!conn) {
        setPrintProgress({ phase: 'Ansluter till skrivare...', percent: 2 });
        // Try auto-reconnect first, fall back to manual picker
        conn = await reconnectLastPrinter().catch(() => null);
        if (!conn) {
          conn = await connectPrinter();
        }
        setBleConn(conn);
        toast({ title: "Ansluten", description: `Ansluten till ${conn.device.name || 'skrivare'}` });
      }
      await printBitmap(conn, canvasRef.current, copies, printSettings, setPrintProgress);
      toast({ title: "Utskrivet!", description: `${copies} etikett${copies > 1 ? 'er' : ''} skickade till skrivaren.` });
    } catch (e: any) {
      if (e?.message?.includes('cancelled') || e?.name === 'NotFoundError') {
        setIsPrinting(false);
        setPrintProgress(null);
        return;
      }
      toast({ title: "Utskriftsfel", description: e.message, variant: "destructive" });
      setBleConn(null);
    } finally {
      setIsPrinting(false);
      setTimeout(() => setPrintProgress(null), 2000);
    }
  };


  const handlePrint = () => {
    if (!canvasRef.current) return;
    const trimmed = trimCanvas(canvasRef.current, 4);
    const dataUrl = trimmed.toDataURL('image/png');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`
      <html><head><title>Etikett</title>
      <style>@page{size:50mm 70mm;margin:0}body{margin:0;display:flex;justify-content:center;align-items:center;height:100vh}img{max-width:100%;max-height:100%}</style>
      </head><body><img src="${dataUrl}" onload="window.print();window.close()"/></body></html>
    `);
    win.document.close();
  };

  const handleDownloadPdf = async () => {
    if (!canvasRef.current) return;
    const { default: jsPDF } = await import('jspdf');
    const trimmed = trimCanvas(canvasRef.current, 4);
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [50, 70] });
    pdf.addImage(trimmed.toDataURL('image/png'), 'PNG', 0, 0, 50, 70);
    const safeName = (brew.name || 'etikett').replace(/[^a-zA-ZåäöÅÄÖ0-9\s-]/g, '').trim().replace(/\s+/g, '-');
    pdf.save(`${safeName}-${labelType}.pdf`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            Skriv ut etikett
          </DialogTitle>
        </DialogHeader>

        {/* Tab selection */}
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          <button
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              labelType === 'tank' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setLabelType('tank')}
          >
            🧪 Jästank
          </button>
          <button
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              labelType === 'keg' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setLabelType('keg')}
          >
            🛢️ Fat
          </button>
        </div>

        {/* Canvas preview */}
        <div className="flex justify-center rounded-lg border border-border bg-white p-2">
          <canvas
            ref={canvasRef}
            className="w-full"
            style={{ maxWidth: '384px', imageRendering: 'auto' }}
          />
        </div>

        {/* Copies selector */}
        {hasBle && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Kopior:</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  onClick={() => setCopies(n)}
                  className={`h-8 w-8 rounded-md text-sm font-medium transition-colors ${
                    copies === n
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Bluetooth section */}
        {hasBle && (
          <div className="space-y-2">
            {/* Connection status */}
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                {bleConn ? (
                  <>
                    <Bluetooth className="h-4 w-4 text-primary" />
                    <span className="text-foreground">{bleConn.device.name || 'Skrivare'}</span>
                  </>
                ) : (
                  <>
                    <BluetoothOff className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Ej ansluten</span>
                  </>
                )}
              </div>
              {bleConn ? (
                <Button variant="ghost" size="sm" onClick={handleDisconnect} className="h-7 text-xs">
                  Koppla från
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={handleConnect} disabled={isConnecting} className="h-7 text-xs">
                  {isConnecting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                  Anslut
                </Button>
              )}
            </div>

            {/* Print progress */}
            {printProgress && (
              <div className="space-y-1">
                <Progress value={printProgress.percent} className="h-2" />
                <p className="text-xs text-muted-foreground text-center">{printProgress.phase}</p>
              </div>
            )}

            {/* BLE Print button */}
            <Button
              onClick={handleBlePrint}
              className="w-full gap-2"
              size="lg"
              disabled={isPrinting || isConnecting}
            >
              {isPrinting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isConnecting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Bluetooth className="h-4 w-4" />
              )}
              {isPrinting ? 'Skriver ut...' : isConnecting ? 'Ansluter...' : 'Skriv ut via Bluetooth'}
            </Button>

          </div>
        )}

        {/* Secondary actions - hidden on mobile */}
        <div className="hidden sm:flex gap-2">
          <Button onClick={handleDownloadPdf} variant="outline" className="flex-1 gap-2" size="lg">
            <FileText className="h-4 w-4" />
            Spara som PDF
          </Button>
          <Button onClick={handlePrint} variant="outline" className="gap-2" size="lg">
            <Printer className="h-4 w-4" />
            Skriv ut
          </Button>
        </div>

        {/* Debug settings toggle */}
        <button
          onClick={() => setShowDebug(v => !v)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground/40 hover:text-muted-foreground mx-auto transition-colors"
        >
          <Settings2 className="h-3 w-3" />
          Printer {PRINTER_VERSION} {showDebug ? '▲' : '▼'}
        </button>

        {showDebug && (
          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
            {/* Media type */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Papperstyp (media type)</Label>
              <div className="flex gap-1">
                {(['none', 'gap', 'continuous', 'mark'] as const).map(mt => (
                  <button
                    key={mt}
                    onClick={() => updateSettings({ mediaType: mt })}
                    className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                      printSettings.mediaType === mt
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {mt === 'none' ? 'Av' : mt === 'gap' ? 'Gap' : mt === 'continuous' ? 'Löpande' : 'Mark'}
                  </button>
                ))}
              </div>
            </div>

            {/* Toggle switches */}
            <div className="grid grid-cols-2 gap-2">
              {([
                ['landscape', 'Landscape'] as const,
                ['sendSpeed', 'Skicka Speed'] as const,
                ['sendDensity', 'Skicka Density'] as const,
                ['sendFooter', 'Skicka Footer'] as const,
              ]).map(([key, label]) => (
                <div key={key} className="flex items-center gap-2">
                  <Switch
                    checked={printSettings[key] as boolean}
                    onCheckedChange={(v) => updateSettings({ [key]: v })}
                    className="scale-75"
                  />
                  <span className="text-xs">{label}</span>
                </div>
              ))}
            </div>

            {/* Numeric settings */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {([
                ['speed', 'Speed', 1, 8],
                ['density', 'Density', 1, 8],
                ['chunkSize', 'Chunk (bytes)', 20, 500],
                ['chunkDelay', 'Delay (ms)', 0, 100],
                ['throttleEvery', 'Throttle var N:e', 0, 32],
                ['throttleDelay', 'Throttle ms', 0, 500],
              ] as const).map(([key, label, min, max]) => (
                <div key={key} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <input
                    type="number"
                    min={min}
                    max={max}
                    value={printSettings[key]}
                    onChange={(e) => updateSettings({ [key]: Number(e.target.value) })}
                    className="w-16 rounded border border-border bg-background px-1.5 py-0.5 text-xs text-right"
                  />
                </div>
              ))}
            </div>

            {/* Reset */}
            <button
              onClick={() => {
                setPrintSettings(DEFAULT_PRINT_SETTINGS);
                localStorage.removeItem('phomemo-print-settings');
              }}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              Återställ till standard
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
