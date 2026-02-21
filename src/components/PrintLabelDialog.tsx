import { useState, useRef, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Bluetooth, BluetoothOff, Printer, Loader2, CheckCircle2, Minus, Plus } from "lucide-react";
import { BrewData } from "@/types/brew";
import { renderTankLabel, renderKegLabel } from "./LabelCanvas";
import { connectPrinter, disconnectPrinter, printBitmap, isBluetoothSupported, type PrinterConnection } from "@/lib/thermal-printer";

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
      // Small delay to ensure canvas is mounted
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

  const statusLabel = () => {
    switch (status) {
      case 'connecting': return 'Ansluter...';
      case 'connected': return 'Ansluten';
      case 'printing': return 'Skriver ut...';
      case 'done': return 'Klart!';
      case 'error': return errorMsg;
      default: return 'Ej ansluten';
    }
  };

  const statusColor = () => {
    switch (status) {
      case 'connected': case 'done': return 'text-green-400';
      case 'error': return 'text-red-400';
      case 'connecting': case 'printing': return 'text-yellow-400';
      default: return 'text-muted-foreground';
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
            style={{ maxWidth: '559px', imageRendering: 'auto' }}
          />
        </div>

        {/* Bluetooth status */}
        {!btSupported ? (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
            <BluetoothOff className="h-4 w-4 inline mr-2" />
            Web Bluetooth stöds inte. Använd Chrome eller Edge på desktop.
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className={`flex items-center gap-2 text-sm ${statusColor()}`}>
              {status === 'connecting' || status === 'printing' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : status === 'connected' || status === 'done' ? (
                <Bluetooth className="h-4 w-4" />
              ) : status === 'error' ? (
                <BluetoothOff className="h-4 w-4" />
              ) : (
                <BluetoothOff className="h-4 w-4" />
              )}
              <span className="truncate max-w-[200px]">{statusLabel()}</span>
            </div>

            {(status === 'idle' || status === 'error') && (
              <Button size="sm" variant="outline" onClick={handleConnect}>
                <Bluetooth className="h-3.5 w-3.5 mr-1.5" />
                Anslut
              </Button>
            )}
          </div>
        )}

        {/* Copies + Print */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Antal:</span>
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7"
                onClick={() => setCopies(Math.max(1, copies - 1))}
                disabled={copies <= 1}
              >
                <Minus className="h-3 w-3" />
              </Button>
              <span className="w-6 text-center text-sm font-medium">{copies}</span>
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7"
                onClick={() => setCopies(Math.min(10, copies + 1))}
                disabled={copies >= 10}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>

          <Button
            onClick={handlePrint}
            disabled={status !== 'connected'}
            className="gap-2"
          >
            {status === 'printing' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : status === 'done' ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <Printer className="h-4 w-4" />
            )}
            Skriv ut
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
