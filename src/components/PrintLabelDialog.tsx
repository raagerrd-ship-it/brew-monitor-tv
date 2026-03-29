import { useState, useRef, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Printer, FileText, Bluetooth, BluetoothOff, Loader2, Settings, Bug } from "lucide-react";
import { BrewData } from "@/types/brew";
import { renderTankLabel, renderKegLabel } from "./LabelCanvas";
import { PRINTER_VERSION } from "@/lib/thermal-printer";
import { usePrinterConnection } from "@/hooks";
import { printCanvasInWindow, downloadCanvasAsPdf } from "@/lib/label-utils";
import { useNavigate } from "react-router-dom";
import { PrintDebugOverlay } from "./PrintDebugOverlay";

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
  const [debugOpen, setDebugOpen] = useState(false);
  const navigate = useNavigate();

  const {
    hasBle, bleConn, isConnecting, isPrinting, printProgress,
    autoConnectFailed, targetPrinterName,
    retry, print,
  } = usePrinterConnection(open);

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

  const handleBlePrint = () => {
    if (!canvasRef.current) return;
    print(canvasRef.current, copies);
  };

  const handlePrint = () => {
    if (!canvasRef.current) return;
    printCanvasInWindow(canvasRef.current);
  };

  const handleDownloadPdf = async () => {
    if (!canvasRef.current) return;
    await downloadCanvasAsPdf(canvasRef.current, brew.name, labelType);
  };

  const goToSettings = () => {
    onOpenChange(false);
    navigate("/settings?tab=devices");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
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
            {/* Print progress */}
            {printProgress && (
              <div className="space-y-1">
                <Progress value={printProgress.percent} className="h-2" />
                <p className="text-xs text-muted-foreground text-center">{printProgress.phase}</p>
              </div>
            )}

            {/* Single action button */}
            {!targetPrinterName ? (
              <Button onClick={goToSettings} className="w-full gap-2" size="lg" variant="outline">
                <Settings className="h-4 w-4" />
                Välj skrivare i Inställningar
              </Button>
            ) : bleConn ? (
              <Button onClick={handleBlePrint} className="w-full gap-2" size="lg" disabled={isPrinting}>
                {isPrinting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bluetooth className="h-4 w-4" />}
                {isPrinting ? 'Skriver ut...' : 'Skriv ut via Bluetooth'}
              </Button>
            ) : (
              <Button
                onClick={autoConnectFailed ? retry : handleBlePrint}
                className="w-full gap-2"
                size="lg"
                variant={autoConnectFailed ? "outline" : "default"}
                disabled={isConnecting}
              >
                {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bluetooth className="h-4 w-4" />}
                {isConnecting ? 'Ansluter...' : autoConnectFailed ? `Återanslut till ${targetPrinterName}` : 'Skriv ut via Bluetooth'}
              </Button>
            )}
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

        {/* Version label */}
        <p className="text-[10px] text-muted-foreground/30 text-center">Printer {PRINTER_VERSION}</p>
      </DialogContent>
    </Dialog>
  );
}
