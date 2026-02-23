import { useState, useRef, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Printer, FileText } from "lucide-react";
import { BrewData } from "@/types/brew";
import { renderTankLabel, renderKegLabel } from "./LabelCanvas";

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

  const handleDownload = () => {
    if (!canvasRef.current) return;
    const trimmed = trimCanvas(canvasRef.current, 4);
    const link = document.createElement('a');
    const safeName = (brew.name || 'etikett').replace(/[^a-zA-ZåäöÅÄÖ0-9\s-]/g, '').trim().replace(/\s+/g, '-');
    link.download = `${safeName}-${labelType}.png`;
    link.href = trimmed.toDataURL('image/png');
    link.click();
  };

  const handleDownloadPdf = async () => {
    if (!canvasRef.current) return;
    const { default: jsPDF } = await import('jspdf');
    const trimmed = trimCanvas(canvasRef.current, 4);
    // Label: 70x50mm portrait (height 70, width 50)
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
            style={{ maxWidth: '399px', imageRendering: 'auto' }}
          />
        </div>

        {/* Primary actions */}
        <div className="flex gap-2">
          <Button onClick={handleDownloadPdf} className="flex-1 gap-2" size="lg">
            <FileText className="h-4 w-4" />
            Spara som PDF
          </Button>
          <Button onClick={handleDownload} variant="outline" className="gap-2" size="lg">
            <Download className="h-4 w-4" />
            Bild
          </Button>
        </div>
        <p className="text-xs text-muted-foreground text-center -mt-2">
          Öppna PDF:en i PrintMaster → PDF Print
        </p>
      </DialogContent>
    </Dialog>
  );
}
