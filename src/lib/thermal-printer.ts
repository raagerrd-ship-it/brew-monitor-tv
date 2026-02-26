/**
 * Web Bluetooth communication with Phomemo M110 thermal printer.
 * Protocol exactly matches phomemo-tools (vivier/phomemo-tools on GitHub),
 * the proven reverse-engineered CUPS driver for M110/M120/M220.
 *
 * Key protocol details from phomemo-filter.py:
 *  - Image sent in blocks of max 256 lines, each with its own GS v 0 header
 *  - 0x0a bytes in bitmap data replaced with 0x14 (printer interprets 0x0a as LF)
 *  - Footer: ESC d 2 × 2, then 0x1f 0x11 × 4 (status commands)
 *  - Header: ESC @ + ESC a 1 + 0x1f 0x11 0x02 0x04
 *
 * v27 - exact phomemo-tools protocol
 */

export const PRINTER_VERSION = 'v28-hybrid-init-linesminus1';

/** Settings version — bump to auto-reset aggressive user profiles */
export const SETTINGS_VERSION = 4;
const SETTINGS_VERSION_KEY = 'phomemo-settings-version';

/** Configurable print settings for troubleshooting */
export interface PrintSettings {
  mediaType: 'none' | 'gap' | 'continuous' | 'mark';
  landscape: boolean;
  speed: number;        // 1-5
  density: number;      // 1-15 (M110 range)
  chunkSize: number;    // bytes per BLE write
  chunkDelay: number;   // ms between chunks
  throttleEvery: number; // extra pause every N chunks
  throttleDelay: number; // ms for that extra pause
  sendSpeed: boolean;
  sendDensity: boolean;
  sendFooter: boolean;
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  mediaType: 'gap',
  landscape: false,
  speed: 5,
  density: 10,
  chunkSize: 20,
  chunkDelay: 20,
  throttleEvery: 0,
  throttleDelay: 0,
  sendSpeed: true,
  sendDensity: true,
  sendFooter: true,
};

/** Check if saved settings need auto-reset (version migration) */
export function migrateSettingsIfNeeded(): boolean {
  try {
    const savedVersion = Number(localStorage.getItem(SETTINGS_VERSION_KEY) || '0');
    if (savedVersion < SETTINGS_VERSION) {
      localStorage.removeItem('phomemo-print-settings');
      localStorage.setItem(SETTINGS_VERSION_KEY, String(SETTINGS_VERSION));
      console.log(`[Printer] Settings migrated v${savedVersion} → v${SETTINGS_VERSION}, reset to safe defaults`);
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

// ── BLE Service & Characteristic UUIDs ──────────────────────────

const SERVICE_UUIDS = [
  0xff00,
  0xffe0,
  0xae30,
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb',
] as const;

const WRITE_CHAR_UUIDS = [
  0xff02,
  'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
  '49535343-8841-43f4-a8d4-ecbe34729bb3',
];

const BLE_WRITE_TIMEOUT_MS = 7000;
const RECONNECT_TIMEOUT_MS = 6000;
const LAST_PRINTER_NAME_KEY = 'phomemo-last-device-name';
const LAST_PRINTER_ID_KEY = 'phomemo-last-device-id';

// ── Types ───────────────────────────────────────────────────────

export interface PrinterConnection {
  device: any;
  characteristic: any;
  writeMethod: 'withoutResponse' | 'withResponse';
}

export interface PrintProgress {
  phase: string;
  percent: number;
}

// ── Bluetooth helpers ───────────────────────────────────────────

export function isBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in (navigator as any);
}

function saveLastDevice(device: any) {
  try {
    if (device?.name) localStorage.setItem(LAST_PRINTER_NAME_KEY, device.name);
    if (device?.id) localStorage.setItem(LAST_PRINTER_ID_KEY, device.id);
  } catch { /* ignore */ }
}

export function getLastDeviceName(): string | null {
  try { return localStorage.getItem(LAST_PRINTER_NAME_KEY); } catch { return null; }
}

function getLastDeviceId(): string | null {
  try { return localStorage.getItem(LAST_PRINTER_ID_KEY); } catch { return null; }
}

// ── Connection ──────────────────────────────────────────────────

async function connectDevice(device: any): Promise<PrinterConnection> {
  const server = await connectWithRetry(device);

  let service: any = null;
  for (const uuid of SERVICE_UUIDS) {
    try { service = await server.getPrimaryService(uuid as any); break; } catch { /* next */ }
  }
  if (!service) throw new Error('Kunde inte hitta skrivarens BLE-tjänst.');

  let characteristic: any = null;
  for (const uuid of WRITE_CHAR_UUIDS) {
    try { characteristic = await service.getCharacteristic(uuid as any); break; } catch { /* next */ }
  }
  if (!characteristic) throw new Error('Kunde inte hitta skrivarens BLE-karaktäristik.');

  const writeMethod: 'withResponse' | 'withoutResponse' =
    characteristic.properties.writeWithoutResponse ? 'withoutResponse' : 'withResponse';

  console.log(`[Printer] Connected: ${device.name}, write: ${writeMethod}`);
  saveLastDevice(device);
  return { device, characteristic, writeMethod };
}

export async function reconnectLastPrinter(): Promise<PrinterConnection | null> {
  if (!isBluetoothSupported()) return null;
  const lastDeviceName = getLastDeviceName();
  const lastDeviceId = getLastDeviceId();
  if (!lastDeviceName && !lastDeviceId) return null;

  try {
    const bt = navigator as any;
    if (!bt.bluetooth?.getDevices) return null;

    const devices = await bt.bluetooth.getDevices();
    const target = devices.find(
      (d: any) => (lastDeviceId && d.id === lastDeviceId) || (lastDeviceName && d.name === lastDeviceName),
    );
    if (!target) return null;
    if (target.gatt?.connected) return await connectDevice(target);

    if (target.watchAdvertisements) {
      const received = await new Promise<boolean>((resolve) => {
        let done = false;
        const handler = () => { if (done) return; done = true; clearTimeout(t); target.removeEventListener('advertisementreceived', handler); resolve(true); };
        const t = setTimeout(() => { if (done) return; done = true; target.removeEventListener('advertisementreceived', handler); resolve(false); }, RECONNECT_TIMEOUT_MS);
        target.addEventListener('advertisementreceived', handler);
        target.watchAdvertisements().catch(() => {});
      });
      if (received) await delay(120);
    } else {
      await delay(250);
    }

    if (!target.gatt) return null;
    return await connectDevice(target);
  } catch (e: any) {
    console.warn('[Printer] Auto-reconnect failed:', e.message);
    return null;
  }
}

export async function connectPrinter(): Promise<PrinterConnection> {
  if (!isBluetoothSupported()) {
    throw new Error('Web Bluetooth stöds inte i denna webbläsare. Använd Chrome eller Edge.');
  }
  let device: any;
  try {
    device = await (navigator as any).bluetooth.requestDevice({
      filters: [
        { namePrefix: 'M' }, { namePrefix: 'D' }, { namePrefix: 'P' },
        { namePrefix: 'Q' }, { namePrefix: 'T' }, { namePrefix: 'A' },
        { namePrefix: 'Mr.in' }, { namePrefix: 'Phomemo' },
      ],
      optionalServices: SERVICE_UUIDS as any,
    });
  } catch {
    device = await (navigator as any).bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: SERVICE_UUIDS as any,
    });
  }
  return connectDevice(device);
}

async function connectWithRetry(device: any, retries = 2): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) await delay(500 * attempt);
      const server = await device.gatt!.connect();
      await delay(100);
      return server;
    } catch (e) {
      console.warn(`[Printer] GATT attempt ${attempt + 1} failed:`, e);
      if (attempt >= retries) throw new Error('Kunde inte ansluta till skrivaren.');
    }
  }
  throw new Error('Anslutning misslyckades.');
}

export function disconnectPrinter(connection: PrinterConnection): void {
  try { connection.device.gatt?.disconnect(); } catch { /* ignore */ }
}

// ── BLE write primitives ────────────────────────────────────────

async function bleWrite(conn: PrinterConnection, data: Uint8Array, ctx: string): Promise<void> {
  const buffer = new Uint8Array(data).buffer;
  const p = conn.writeMethod === 'withoutResponse'
    ? conn.characteristic.writeValueWithoutResponse(buffer)
    : conn.characteristic.writeValue(buffer);
  await Promise.race([p, delay(BLE_WRITE_TIMEOUT_MS).then(() => { throw new Error(`BLE timeout: ${ctx}`); })]);
}

/** Send a byte buffer in chunks over BLE */
async function sendChunked(
  conn: PrinterConnection,
  data: Uint8Array,
  chunkSize: number,
  chunkDelay: number,
  onProgress?: (sent: number, total: number) => void,
): Promise<void> {
  const total = data.length;
  for (let offset = 0; offset < total; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, total);
    await bleWrite(conn, data.slice(offset, end), `chunk@${offset}`);
    onProgress?.(end, total);
    if (end < total && chunkDelay > 0) await delay(chunkDelay);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── M110 Protocol (from phomemo-tools) ──────────────────────────
//
// phomemo-filter.py header:
//   0x1b 0x40                  ESC @  (initialize)
//   0x1b 0x61 0x01             ESC a  (center justification)
//   0x1f 0x11 0x02 0x04        config (unknown, always sent)
//
// Raster block (max 256 lines per block):
//   0x1d 0x76 0x30 0x00        GS v 0 mode=0
//   <widthBytes> (2 bytes LE)  e.g. 0x30 0x00 = 48
//   <lines - 1>  (2 bytes LE)  height of this block minus 1
//   <bitmap data>              with 0x0a bytes replaced by 0x14
//
// CUPS driver (rastertopm110.py) header:
//   0x1b 0x4e 0x0d <speed>     speed 1-5
//   0x1b 0x4e 0x04 <density>   density 1-15
//   0x1f 0x11 <media_type>     0x0a=gap, 0x0b=continuous, 0x26=marks
//
// CUPS driver raster: same GS v 0, but height = lines (not lines-1)
//   and NO 0x0a escaping (USB transport doesn't have this issue)
//
// phomemo-filter.py footer:
//   0x1b 0x64 0x02             ESC d 2 (print and feed 2 lines)
//   0x1b 0x64 0x02             ESC d 2 (again)
//   0x1f 0x11 0x08             status command
//   0x1f 0x11 0x0e             status command
//   0x1f 0x11 0x07             status command
//   0x1f 0x11 0x09             status command
//
// CUPS driver footer:
//   0x1f 0xf0 0x05 0x00
//   0x1f 0xf0 0x03 0x00
//
// We use the CUPS driver sequence (speed+density+media header, CUPS footer)
// combined with the phomemo-filter.py 0x0a escaping and 256-line blocking.

const MAX_BLOCK_LINES = 256;

function mediaTypeCode(mt: string): number | null {
  if (mt === 'gap') return 0x0a;
  if (mt === 'continuous') return 0x0b;
  if (mt === 'mark') return 0x26;
  return null;
}

/**
 * Build one raster block: GS v 0 header + bitmap data (with 0x0a escaping).
 * Uses height = blockLines (matching CUPS driver, NOT the filter.py lines-1).
 */
function buildRasterBlock(
  bitmapRows: Uint8Array[],
  startLine: number,
  blockLines: number,
  bytesPerRow: number,
): Uint8Array {
  const linesField = Math.max(0, blockLines - 1);
  const header = new Uint8Array([
    0x1d, 0x76, 0x30, 0x00,
    bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff,
    linesField & 0xff, (linesField >> 8) & 0xff,
  ]);

  // Bitmap data with 0x0a → 0x14 escaping
  const dataSize = bytesPerRow * blockLines;
  const data = new Uint8Array(dataSize);
  for (let i = 0; i < blockLines; i++) {
    const row = bitmapRows[startLine + i];
    for (let j = 0; j < bytesPerRow; j++) {
      let byte = row[j];
      // CRITICAL: 0x0a in bitmap data is interpreted as LineFeed by the printer!
      // phomemo-filter.py replaces it with 0x14 to avoid breaking the rendering.
      if (byte === 0x0a) byte = 0x14;
      data[i * bytesPerRow + j] = byte;
    }
  }

  // Concatenate header + data
  const block = new Uint8Array(header.length + data.length);
  block.set(header, 0);
  block.set(data, header.length);
  return block;
}

/**
 * Print canvas to Phomemo M110 using the exact protocol from phomemo-tools.
 */
export async function printBitmap(
  connection: PrinterConnection,
  canvas: HTMLCanvasElement,
  copies: number = 1,
  settings: PrintSettings = DEFAULT_PRINT_SETTINGS,
  onProgress?: (p: PrintProgress) => void,
): Promise<void> {
  // ── 1. Normalize to 384px width ──
  let workingCanvas = canvas;
  const targetWidth = 384;
  if (canvas.width !== targetWidth) {
    const scaled = document.createElement('canvas');
    const scaledHeight = Math.max(1, Math.round((canvas.height * targetWidth) / canvas.width));
    scaled.width = targetWidth;
    scaled.height = scaledHeight;
    const sctx = scaled.getContext('2d');
    if (!sctx) throw new Error('Kunde inte skala etikettbild för utskrift.');
    sctx.imageSmoothingEnabled = false;
    sctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, scaled.width, scaled.height);
    workingCanvas = scaled;
    console.log(`[Printer] Rescaled ${canvas.width}x${canvas.height} → ${scaled.width}x${scaled.height}`);
  }

  const width = workingCanvas.width;
  const height = workingCanvas.height;
  const ctx = workingCanvas.getContext('2d')!;
  const imageData = ctx.getImageData(0, 0, width, height);

  // ── 2. Dither to 1-bit monochrome ──
  onProgress?.({ phase: 'Förbereder bild...', percent: 5 });
  const pixels = ditherToMonochrome(imageData);

  // ── 3. Convert to bitmap rows (1 bit per pixel, MSB first, 1=black) ──
  const bytesPerRow = Math.ceil(width / 8); // 384/8 = 48
  const bitmapRows: Uint8Array[] = [];
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(bytesPerRow);
    for (let x = 0; x < width; x++) {
      if (pixels[y * width + x] === 0) { // black pixel
        row[Math.floor(x / 8)] |= (1 << (7 - (x % 8)));
      }
    }
    bitmapRows.push(row);
  }

  // ── 4. Build protocol preamble + header ──
  const headerParts: Uint8Array[] = [
    // Legacy BLE preamble used by phomemo-filter path
    new Uint8Array([0x1b, 0x40, 0x1b, 0x61, 0x01, 0x1f, 0x11, 0x02, 0x04]),
  ];

  // Speed: ESC N 0x0d <speed>
  if (settings.sendSpeed) {
    headerParts.push(new Uint8Array([0x1b, 0x4e, 0x0d, Math.max(1, Math.min(5, settings.speed))]));
  }

  // Density: ESC N 0x04 <density>
  if (settings.sendDensity) {
    headerParts.push(new Uint8Array([0x1b, 0x4e, 0x04, Math.max(1, Math.min(15, settings.density))]));
  }

  // Media type: 0x1f 0x11 <type>
  const mc = mediaTypeCode(settings.mediaType);
  if (mc !== null) {
    headerParts.push(new Uint8Array([0x1f, 0x11, mc]));
  }

  // Flatten header
  const headerLen = headerParts.reduce((s, p) => s + p.length, 0);
  const headerBuf = new Uint8Array(headerLen);
  let hOff = 0;
  for (const p of headerParts) { headerBuf.set(p, hOff); hOff += p.length; }

  // ── 5. Build raster blocks (max 256 lines each) ──
  const blocks: Uint8Array[] = [];
  let remaining = height;
  let line = 0;
  while (remaining > 0) {
    const blockLines = Math.min(remaining, MAX_BLOCK_LINES);
    blocks.push(buildRasterBlock(bitmapRows, line, blockLines, bytesPerRow));
    line += blockLines;
    remaining -= blockLines;
  }

  // ── 6. Build footer (from CUPS rastertopm110.py) ──
  const footer = new Uint8Array([
    0x1f, 0xf0, 0x05, 0x00,
    0x1f, 0xf0, 0x03, 0x00,
  ]);

  // Total data size for progress
  const totalDataSize = headerLen + blocks.reduce((s, b) => s + b.length, 0) + footer.length;

  console.log(`[Printer] ${PRINTER_VERSION}: ${width}x${height}, ${blocks.length} block(s), ${totalDataSize} bytes, copies=${copies}`);

  // ── 7. Send ──
  for (let copy = 0; copy < copies; copy++) {
    const copyLabel = copies > 1 ? ` (${copy + 1}/${copies})` : '';
    let sent = 0;
    const reportProgress = (added: number) => {
      sent += added;
      const pct = 10 + ((copy + sent / totalDataSize) / copies) * 85;
      onProgress?.({ phase: `Skriver ut${copyLabel}...`, percent: Math.min(97, pct) });
    };

    onProgress?.({ phase: `Skickar header${copyLabel}...`, percent: 10 });

    // Send header
    await sendChunked(connection, headerBuf, settings.chunkSize, settings.chunkDelay,
      (s) => reportProgress(s - sent + headerLen - totalDataSize > 0 ? 0 : 0));
    // Small pause after header to let printer process settings
    await delay(50);

    // Send raster blocks
    for (let bi = 0; bi < blocks.length; bi++) {
      await sendChunked(connection, blocks[bi], settings.chunkSize, settings.chunkDelay,
        (s, t) => {
          const blockPct = 10 + ((copy + (headerLen + blocks.slice(0, bi).reduce((a, b) => a + b.length, 0) + s) / totalDataSize) / copies) * 85;
          onProgress?.({ phase: `Skriver ut${copyLabel} (block ${bi + 1}/${blocks.length})...`, percent: Math.min(97, blockPct) });
        });
      // Small pause between blocks
      if (bi < blocks.length - 1) await delay(30);
    }

    // Send footer
    if (settings.sendFooter) {
      await delay(100);
      await sendChunked(connection, footer, settings.chunkSize, settings.chunkDelay);
    }

    if (copy < copies - 1) await delay(800);
  }

  onProgress?.({ phase: 'Klar!', percent: 100 });
}

/**
 * Print a visible test page.
 */
export async function printTestPage(
  connection: PrinterConnection,
  onProgress?: (p: PrintProgress) => void,
): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 240;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Kunde inte skapa testcanvas.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 384, 240);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 384, 10);
  ctx.fillRect(0, 230, 384, 10);
  ctx.fillRect(0, 0, 10, 240);
  ctx.fillRect(374, 0, 10, 240);
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#000000';
  ctx.beginPath();
  ctx.moveTo(20, 20); ctx.lineTo(364, 220);
  ctx.moveTo(364, 20); ctx.lineTo(20, 220);
  ctx.stroke();
  ctx.fillRect(132, 100, 120, 40);

  await printBitmap(connection, canvas, 1, DEFAULT_PRINT_SETTINGS, onProgress);
}

/**
 * Floyd-Steinberg dithering → array of 0 (black) or 255 (white).
 */
function ditherToMonochrome(imageData: ImageData): Uint8Array {
  const w = imageData.width;
  const h = imageData.height;
  const data = imageData.data;

  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
    const alpha = a / 255;
    gray[i] = (0.299 * r + 0.587 * g + 0.114 * b) * alpha + 255 * (1 - alpha);
  }

  const result = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const oldVal = gray[idx];
      const newVal = oldVal < 128 ? 0 : 255;
      result[idx] = newVal;
      const error = oldVal - newVal;
      if (x + 1 < w) gray[idx + 1] += error * 7 / 16;
      if (y + 1 < h) {
        if (x - 1 >= 0) gray[(y + 1) * w + (x - 1)] += error * 3 / 16;
        gray[(y + 1) * w + x] += error * 5 / 16;
        if (x + 1 < w) gray[(y + 1) * w + (x + 1)] += error * 1 / 16;
      }
    }
  }
  return result;
}