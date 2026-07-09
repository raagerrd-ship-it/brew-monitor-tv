/** Trim white pixels from canvas edges, keeping a small margin */
export function trimCanvas(source: HTMLCanvasElement, margin = 4): HTMLCanvasElement {
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

/** Open a print window with the trimmed canvas image */
export function printCanvasInWindow(canvas: HTMLCanvasElement): void {
  const trimmed = trimCanvas(canvas, 4);
  const dataUrl = trimmed.toDataURL('image/png');
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`
    <html><head><title>Etikett</title>
    <style>@page{size:50mm 70mm;margin:0}body{margin:0;display:flex;justify-content:center;align-items:center;height:100vh}img{max-width:100%;max-height:100%}</style>
    </head><body><img src="${dataUrl}" onload="window.print();window.close()"/></body></html>
  `);
  win.document.close();
}

/** Trigger a file download from a Blob, with mobile fallback. */
export function triggerFileDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  if (isIOS) {
    // iOS Safari does not reliably honour the download attribute;
    // open the blob in a new tab so the user can use Share → Save to Files.
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Download the trimmed canvas as a PDF */
export async function downloadCanvasAsPdf(canvas: HTMLCanvasElement, name: string, labelType: string): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const trimmed = trimCanvas(canvas, 4);
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [50, 70] });
  pdf.addImage(trimmed.toDataURL('image/png'), 'PNG', 0, 0, 50, 70);
  const safeName = (name || 'etikett').replace(/[^a-zA-ZåäöÅÄÖ0-9\s-]/g, '').trim().replace(/\s+/g, '-');
  const blob = pdf.output('blob');
  triggerFileDownload(blob, `${safeName}-${labelType}.pdf`);
}
