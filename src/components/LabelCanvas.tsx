/**
 * Canvas label renderer for 70x50mm thermal labels (559x399px at 203 DPI).
 * Two label types: Tank (fermentation) and Keg (packaging).
 */
import { BrewData } from "@/types/brew";
import QRCode from 'qrcode';

const LABEL_WIDTH = 399;
const LABEL_HEIGHT = 559;
const PADDING = 24;
const LABEL_IMG_SIZE = 120;
const QR_SIZE = 150;
const PUBLISHED_URL = 'https://brew-monitor-tv.lovable.app';

/** Get the share URL for a brew */
function getBrewShareUrl(brew: BrewData): string {
  const shareId = brew.share_id || brew.batch_id;
  return `${PUBLISHED_URL}/brew/${encodeURIComponent(shareId)}`;
}

/** Generate a QR code as an HTMLImageElement */
async function generateQrImage(url: string): Promise<HTMLImageElement | null> {
  try {
    const dataUrl = await QRCode.toDataURL(url, {
      width: QR_SIZE * 2, // 2x for sharpness
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    });
    return loadImage(dataUrl);
  } catch {
    return null;
  }
}

interface LabelOptions {
  brew: BrewData;
  canvas: HTMLCanvasElement;
}

/** Load an image, returns null on failure */
async function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Get brew date from events or fallback */
function getBrewDate(brew: BrewData): string {
  const brewEvent = brew.events?.find(e => e.event_type === 'Bryggdag');
  if (brewEvent) return new Date(brewEvent.event_date).toLocaleDateString('sv-SE');
  // Fallback to first SG reading date
  if (brew.sgData?.length > 0) return new Date(brew.sgData[0].date).toLocaleDateString('sv-SE');
  return new Date().toLocaleDateString('sv-SE');
}

/** Get fermentation temp from current data */
function getFermentationTemp(brew: BrewData): string {
  if (brew.fermentationSession?.controller_target_temp != null) {
    return `${brew.fermentationSession.controller_target_temp.toFixed(1)}°C`;
  }
  if (brew.currentTemp) return `${brew.currentTemp.toFixed(1)}°C`;
  return '—';
}

/** Draw common label background and border */
function drawLabelBase(ctx: CanvasRenderingContext2D) {
  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, LABEL_WIDTH, LABEL_HEIGHT);
  
  // Border
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, LABEL_WIDTH - 4, LABEL_HEIGHT - 4);
  
  // Inner decorative line
  ctx.lineWidth = 1;
  ctx.strokeRect(8, 8, LABEL_WIDTH - 16, LABEL_HEIGHT - 16);
}

/** Draw label image in top-right corner if available */
function drawLabelImage(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null) {
  if (!img) return;
  const x = LABEL_WIDTH - PADDING - LABEL_IMG_SIZE;
  const y = PADDING;
  
  // Draw with rounded corners effect (clip)
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, LABEL_IMG_SIZE, LABEL_IMG_SIZE, 6);
  ctx.clip();
  ctx.drawImage(img, x, y, LABEL_IMG_SIZE, LABEL_IMG_SIZE);
  ctx.restore();
  
  // Border around image
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, LABEL_IMG_SIZE, LABEL_IMG_SIZE, 6);
  ctx.stroke();
}

/** Render Jästank (fermentation tank) label */
export async function renderTankLabel({ brew, canvas }: LabelOptions): Promise<void> {
  canvas.width = LABEL_WIDTH;
  canvas.height = LABEL_HEIGHT;
  const ctx = canvas.getContext('2d')!;
  
  drawLabelBase(ctx);
  
  // Load label image
  const labelImg = brew.label_image_url ? await loadImage(brew.label_image_url) : null;
  drawLabelImage(ctx, labelImg);
  
  const textMaxWidth = labelImg ? LABEL_WIDTH - PADDING * 2 - LABEL_IMG_SIZE - 12 : LABEL_WIDTH - PADDING * 2;
  
  // Brew name (large)
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 44px sans-serif';
  let y = PADDING + 50;
  const name = brew.name || 'Okänd';
  
  // Word-wrap brew name if needed
  const words = name.split(' ');
  let line = '';
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > textMaxWidth && line) {
      ctx.fillText(line, PADDING, y);
      line = word;
      y += 48;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, PADDING, y);
  y += 20;
  
  // Style
  if (brew.style && brew.style !== 'Okänd stil') {
    ctx.font = 'italic 24px sans-serif';
    y += 32;
    ctx.fillText(brew.style, PADDING, y);
  }
  
  // Divider
  y += 20;
  ctx.beginPath();
  ctx.moveTo(PADDING, y);
  ctx.lineTo(LABEL_WIDTH - PADDING, y);
  ctx.strokeStyle = '#999999';
  ctx.lineWidth = 0.5;
  ctx.stroke();
  y += 8;
  
  // Data rows
  ctx.font = '22px sans-serif';
  const dataFont = 'bold 22px sans-serif';
  const rows = [
    { label: 'OG', value: brew.originalGravity ? brew.originalGravity.toFixed(3) : '—' },
    { label: 'Datum', value: getBrewDate(brew) },
    { label: 'Jästemp', value: getFermentationTemp(brew) },
  ];
  
  for (const row of rows) {
    y += 34;
    ctx.font = '22px sans-serif';
    ctx.fillText(`${row.label}:`, PADDING, y);
    ctx.font = dataFont;
    ctx.fillText(row.value, PADDING + 150, y);
  }
  
  // QR code in bottom-right corner
  const qrImg = await generateQrImage(getBrewShareUrl(brew));
  if (qrImg) {
    const qrX = LABEL_WIDTH - PADDING - QR_SIZE;
    const qrY = LABEL_HEIGHT - PADDING - QR_SIZE;
    ctx.drawImage(qrImg, qrX, qrY, QR_SIZE, QR_SIZE);
    // Small label under QR
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#666666';
    ctx.textAlign = 'center';
    ctx.fillText('Skanna för info', qrX + QR_SIZE / 2, qrY + QR_SIZE + 12);
    ctx.textAlign = 'start';
    ctx.fillStyle = '#000000';
  }
}

/** Render Fat (keg) label */
export async function renderKegLabel({ brew, canvas }: LabelOptions): Promise<void> {
  canvas.width = LABEL_WIDTH;
  canvas.height = LABEL_HEIGHT;
  const ctx = canvas.getContext('2d')!;
  
  drawLabelBase(ctx);
  
  // Load label image
  const labelImg = brew.label_image_url ? await loadImage(brew.label_image_url) : null;
  drawLabelImage(ctx, labelImg);
  
  const textMaxWidth = labelImg ? LABEL_WIDTH - PADDING * 2 - LABEL_IMG_SIZE - 12 : LABEL_WIDTH - PADDING * 2;
  
  // Title: FAT / KEG
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('FAT / KEG', PADDING, PADDING + 20);
  
  // Separator line
  ctx.beginPath();
  ctx.moveTo(PADDING, PADDING + 30);
  ctx.lineTo(PADDING + textMaxWidth, PADDING + 30);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.stroke();
  
  // Brew name (large)
  ctx.font = 'bold 44px sans-serif';
  let y = PADDING + 78;
  const name = brew.name || 'Okänd';
  
  // Word-wrap brew name
  const words = name.split(' ');
  let line = '';
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > textMaxWidth && line) {
      ctx.fillText(line, PADDING, y);
      line = word;
      y += 48;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, PADDING, y);
  y += 20;
  
  // Style
  if (brew.style && brew.style !== 'Okänd stil') {
    ctx.font = 'italic 24px sans-serif';
    y += 32;
    ctx.fillText(brew.style, PADDING, y);
  }
  
  // Divider
  y += 20;
  ctx.beginPath();
  ctx.moveTo(PADDING, y);
  ctx.lineTo(LABEL_WIDTH - PADDING, y);
  ctx.strokeStyle = '#999999';
  ctx.lineWidth = 0.5;
  ctx.stroke();
  y += 8;
  
  // Data rows
  const dataFont = 'bold 22px sans-serif';
  const rows = [
    { label: 'ABV', value: brew.abv ? `${brew.abv.toFixed(1)}%` : '—' },
    { label: 'OG → FG', value: `${brew.originalGravity?.toFixed(3) || '—'} → ${brew.finalGravity?.toFixed(3) || '—'}` },
    { label: 'Tappat', value: new Date().toLocaleDateString('sv-SE') },
    { label: 'Batch', value: brew.batchNumber || '—' },
  ];
  
  for (const row of rows) {
    y += 34;
    ctx.font = '22px sans-serif';
    ctx.fillText(`${row.label}:`, PADDING, y);
    ctx.font = dataFont;
    ctx.fillText(row.value, PADDING + 150, y);
  }
}
