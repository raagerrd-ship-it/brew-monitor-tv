import { useState, useRef, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Bluetooth, BluetoothOff, Printer, Loader2, CheckCircle2, Minus, Plus } from "lucide-react";
import { BrewData } from "@/types/brew";
import { renderTankLabel, renderKegLabel } from "./LabelCanvas";
import { connectPrinter, disconnectPrinter, printBitmap, isBluetoothSupported, type PrinterConnection } from "@/lib/thermal-printer";

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
type PrintStatus = 'idle' | 'connecting' | 'connected' | 'printing' | 'done' | 'error';

interface PrintLabelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brew: BrewData;
}

export function PrintLabelDialog({ open, onOpenChange, brew }: PrintLabelDialogProps) {
  const [labelType, setLabelType] = useState<LabelType>('tank');
  const [copies, setCopies] = useState(1);
  const [status, setStatus] = useState<PrintStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [showBle, setShowBle] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const connectionRef = useRef<PrinterConnection | null>(null);
  const btSupported = isBluetoothSupported();

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

  // Cleanup on close
  useEffect(() => {
    if (!open && connectionRef.current) {
      disconnectPrinter(connectionRef.current);
      connectionRef.current = null;
      setStatus('idle');
    }
  }, [open]);

  const handleDownload = () => {
    if (!canvasRef.current) return;
    const trimmed = trimCanvas(canvasRef.current, 4);
    const link = document.createElement('a');
    const safeName = (brew.name || 'etikett').replace(/[^a-zA-ZåäöÅÄÖ0-9\s-]/g, '').trim().replace(/\s+/g, '-');
    link.download = `${safeName}-${labelType}.png`;
    link.href = trimmed.toDataURL('image/png');
    link.click();
  };

  const handleConnect = async () => {
    setStatus('connecting');
    setErrorMsg('');
    try {
      const conn = await connectPrinter();
      connectionRef.current = conn;
      setStatus('connected');
      conn.device.addEventListener('gattserverdisconnected', () => {
        connectionRef.current = null;
        setStatus('idle');
      });
    } catch (err: any) {
      setErrorMsg(err?.message || 'Kunde inte ansluta till skrivaren');
      setStatus('error');
    }
  };

  const handlePrint = async () => {
    if (!connectionRef.current || !canvasRef.current) return;
    setStatus('printing');
    setErrorMsg('');
    try {
      await printBitmap(connectionRef.current, canvasRef.current, copies);
      setStatus('done');
      setTimeout(() => setStatus('connected'), 2000);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Utskriften misslyckades');
      setStatus('error');
    }
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
            style={{ maxWidth: '399px', imageRendering: 'auto' }}
          />
        </div>

        {/* Primary action: Download image */}
        <Button onClick={handleDownload} className="w-full gap-2" size="lg">
          <Download className="h-4 w-4" />
          Spara etikett som bild
        </Button>
        <p className="text-xs text-muted-foreground text-center -mt-2">
          Öppna bilden i Phomemo-appen för att skriva ut
        </p>

        {/* BLE section (collapsible, secondary) */}
        {btSupported && (
          <div className="border-t border-border pt-3 mt-1">
            <button
              className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center"
              onClick={() => setShowBle(!showBle)}
            >
              {showBle ? '▾ Dölj direktutskrift (BLE)' : '▸ Direktutskrift via Bluetooth (BLE)'}
            </button>

            {showBle && (
              <div className="mt-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className={`flex items-center gap-2 text-sm ${
                    status === 'connected' || status === 'done' ? 'text-green-400' :
                    status === 'error' ? 'text-red-400' :
                    status === 'connecting' || status === 'printing' ? 'text-yellow-400' :
                    'text-muted-foreground'
                  }`}>
                    {status === 'connecting' || status === 'printing' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : status === 'connected' || status === 'done' ? (
                      <Bluetooth className="h-4 w-4" />
                    ) : (
                      <BluetoothOff className="h-4 w-4" />
                    )}
                    <span className="truncate max-w-[200px]">
                      {status === 'connecting' ? 'Ansluter...' :
                       status === 'connected' ? 'Ansluten' :
                       status === 'printing' ? 'Skriver ut...' :
                       status === 'done' ? 'Klart!' :
                       status === 'error' ? errorMsg :
                       'Ej ansluten'}
                    </span>
                  </div>

                  {(status === 'idle' || status === 'error') && (
                    <Button size="sm" variant="outline" onClick={handleConnect}>
                      <Bluetooth className="h-3.5 w-3.5 mr-1.5" />
                      Anslut
                    </Button>
                  )}
                </div>

                {(status === 'connected' || status === 'printing' || status === 'done') && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Antal:</span>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="outline" className="h-7 w-7"
                          onClick={() => setCopies(Math.max(1, copies - 1))} disabled={copies <= 1}>
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-6 text-center text-sm font-medium">{copies}</span>
                        <Button size="icon" variant="outline" className="h-7 w-7"
                          onClick={() => setCopies(Math.min(10, copies + 1))} disabled={copies >= 10}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <Button onClick={handlePrint} disabled={status === 'printing'} className="gap-2">
                      {status === 'printing' ? <Loader2 className="h-4 w-4 animate-spin" /> :
                       status === 'done' ? <CheckCircle2 className="h-4 w-4" /> :
                       <Printer className="h-4 w-4" />}
                      Skriv ut
                    </Button>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  OBS: M110 använder ofta klassisk Bluetooth, inte BLE. Om skrivaren inte hittas, använd "Spara som bild" ovan.
                </p>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
